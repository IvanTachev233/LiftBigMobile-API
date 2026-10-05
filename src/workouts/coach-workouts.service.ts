import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { User } from '../auth/user.entity';
import { AuthUser } from '../auth/auth-user.interface';
import {
  CreateCoachWorkoutDto,
  UpdateCoachWorkoutDto,
} from './dto/coach-workout.dto';
import {
  CARD_RELATIONS,
  assertExercisesVisible,
  assertOwnIds,
  loadCards,
  lockWorkout,
  refreshTotal,
  saveCardsInPlace,
  toWorkoutView,
} from './workout-cards';

// Workouts a coach assigns to their clients. The coach writes the plan only;
// results and status belong to the client.
@Injectable()
export class CoachWorkoutsService {
  constructor(
    @InjectRepository(Workout)
    private workoutRepo: Repository<Workout>,
    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,
  ) {}

  // Checked against the client's current coach in the database, not the
  // caller's token.
  private async assertClient(
    manager: EntityManager,
    clientId: string,
    coach: AuthUser,
  ): Promise<void> {
    const count = await manager.count(User, {
      where: { id: clientId, coachId: coach.id },
    });
    if (count === 0) {
      throw new ForbiddenException('Client not found or not assigned to you');
    }
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(`Workout with ID "${id}" not found`);
  }

  async findForClient(clientId: string, coach: AuthUser): Promise<Workout[]> {
    await this.assertClient(this.workoutRepo.manager, clientId, coach);
    const workouts = await this.workoutRepo.find({
      where: { userId: clientId, assignedById: coach.id },
      relations: CARD_RELATIONS,
      order: { date: 'DESC' },
    });
    return workouts.map(toWorkoutView);
  }

  async createForClient(
    clientId: string,
    dto: CreateCoachWorkoutDto,
    coach: AuthUser,
  ): Promise<Workout> {
    await this.assertClient(this.workoutRepo.manager, clientId, coach);
    assertOwnIds([], dto.exercises, 'planned');
    await assertExercisesVisible(
      this.exerciseRepo,
      dto.exercises.map((card) => card.exerciseId),
      coach.id,
    );

    const id = await this.workoutRepo.manager.transaction(async (manager) => {
      const { identifiers } = await manager.insert(Workout, {
        userId: clientId,
        assignedById: coach.id,
        name: dto.name,
        date: new Date(dto.date),
        notes: dto.notes ?? null,
        isTemplate: false,
        status: WorkoutStatus.PLANNED,
        totalWeightLifted: 0,
      } as DeepPartial<Workout>);
      const workoutId = identifiers[0].id as string;
      await saveCardsInPlace(manager, workoutId, [], dto.exercises, 'planned');
      return workoutId;
    });

    return this.findOne(id, coach);
  }

  async findOne(id: string, coach: AuthUser): Promise<Workout> {
    const workout = await this.workoutRepo.findOne({
      where: { id, assignedById: coach.id },
      relations: CARD_RELATIONS,
    });
    if (!workout) throw this.notFound(id);
    await this.assertClient(this.workoutRepo.manager, workout.userId, coach);
    return toWorkoutView(workout);
  }

  // Saves the plan in place by id; results and status are never written.
  async update(
    id: string,
    dto: UpdateCoachWorkoutDto,
    coach: AuthUser,
  ): Promise<Workout> {
    const patch: DeepPartial<Workout> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.date !== undefined) patch.date = new Date(dto.date);
    const cards = dto.exercises;

    await this.workoutRepo.manager.transaction(async (manager) => {
      const workout = await lockWorkout(manager, {
        id,
        assignedById: coach.id,
      });
      if (!workout) throw this.notFound(id);
      await this.assertClient(manager, workout.userId, coach);

      if (cards !== undefined) {
        const existing = await loadCards(manager, id);
        assertOwnIds(existing, cards, 'planned');
        await assertExercisesVisible(
          manager.getRepository(Exercise),
          cards.map((card) => card.exerciseId),
          coach.id,
        );
        await saveCardsInPlace(manager, id, existing, cards, 'planned');
      }
      if (Object.keys(patch).length > 0) {
        await manager.update(Workout, { id }, patch);
      }
      if (cards !== undefined) await refreshTotal(manager, id);
    });

    return this.findOne(id, coach);
  }

  async remove(id: string, coach: AuthUser): Promise<void> {
    await this.workoutRepo.manager.transaction(async (manager) => {
      const workout = await lockWorkout(manager, {
        id,
        assignedById: coach.id,
      });
      if (!workout) throw this.notFound(id);
      await this.assertClient(manager, workout.userId, coach);
      await manager.delete(Workout, { id });
    });
  }
}
