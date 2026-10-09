import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, Not, DeepPartial } from 'typeorm';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutExercise } from './entities/workout-exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import {
  CreateWorkoutDto,
  UpdateWorkoutDto,
  CreateExerciseDto,
  AddSetDto,
  SetResultDto,
} from './dto/workout.dto';
import { AuthUser } from '../auth/auth-user.interface';
import {
  nameEqualsIgnoringCase,
  ownerIdForVisibility,
  visibleExerciseWhere,
} from './exercise-visibility.util';
import {
  CARD_RELATIONS,
  assertExercisesVisible,
  assertOwnIds,
  isPlanLocked,
  loadCards,
  lockWorkout,
  markStarted,
  programNamesOf,
  refreshTotal,
  saveCardsInPlace,
  toWorkoutView,
} from './workout-cards';
import { completeEnrollmentIfDone } from '../programs/enrollment-completion';

@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(Workout)
    private workoutRepo: Repository<Workout>,
    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,
  ) {}

  async findAllExercises(user: AuthUser): Promise<Exercise[]> {
    const ownerId = ownerIdForVisibility(user);
    return this.exerciseRepo.find({
      where: visibleExerciseWhere(ownerId),
      order: { name: 'ASC' },
    });
  }

  async createExercise(
    dto: CreateExerciseDto,
    user: AuthUser,
  ): Promise<Exercise> {
    const ownerId = ownerIdForVisibility(user);
    const clash = await this.exerciseRepo.findOne({
      where: visibleExerciseWhere(ownerId, {
        name: nameEqualsIgnoringCase(dto.name),
      }),
    });
    if (clash) {
      throw new ConflictException(
        `An exercise named "${dto.name}" already exists`,
      );
    }

    const exercise = this.exerciseRepo.create({
      name: dto.name,
      description: dto.description,
      bodyPart: dto.bodyPart,
      videoUrl: dto.videoUrl ?? null,
      createdById: user.id,
    });
    return this.exerciseRepo.save(exercise);
  }

  async create(
    createWorkoutDto: CreateWorkoutDto,
    user: AuthUser,
  ): Promise<Workout> {
    const workout = this.workoutRepo.create({
      date: createWorkoutDto.date,
      name: createWorkoutDto.name,
      notes: createWorkoutDto.notes,
      isTemplate: createWorkoutDto.isTemplate,
      userId: user.id,
      assignedById: null,
      status: WorkoutStatus.PLANNED,
    } as DeepPartial<Workout>);
    const saved = await this.workoutRepo.save(workout);
    saved.exercises ??= [];
    saved.assignedBy ??= null;
    return saved;
  }

  // Own workouts: self-made, assigned and from programs.
  async findAll(user: AuthUser): Promise<Workout[]> {
    const workouts = await this.workoutRepo.find({
      where: { userId: user.id },
      order: { date: 'DESC' },
      relations: CARD_RELATIONS,
    });
    return this.toViews(workouts);
  }

  async findUpcoming(user: AuthUser): Promise<Workout[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const workouts = await this.workoutRepo.find({
      where: {
        userId: user.id,
        date: MoreThanOrEqual(today),
        status: Not(WorkoutStatus.COMPLETED),
      },
      relations: CARD_RELATIONS,
      order: { date: 'ASC' },
    });
    return this.toViews(workouts);
  }

  async findOne(id: string, user: AuthUser): Promise<Workout> {
    const workout = await this.workoutRepo.findOne({
      where: { id, userId: user.id },
      relations: CARD_RELATIONS,
    });
    if (!workout)
      throw new NotFoundException(`Workout with ID "${id}" not found`);

    const [view] = await this.toViews([workout]);
    return view;
  }

  // Self-made: every field, cards saved in place by id. Assigned or from a
  // program: status only. Completing the last workout of a program
  // completes its enrollment.
  async update(
    id: string,
    updateWorkoutDto: UpdateWorkoutDto,
    user: AuthUser,
  ): Promise<Workout> {
    const { exercises: cards, date, ...fields } = updateWorkoutDto;
    // DTO instances carry unset fields as own `undefined` properties
    const patch: DeepPartial<Workout> = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    if (date !== undefined) patch.date = new Date(date);

    await this.workoutRepo.manager.transaction(async (manager) => {
      const workout = await lockWorkout(manager, { id, userId: user.id });
      if (!workout) {
        throw new NotFoundException(`Workout with ID "${id}" not found`);
      }
      const changesPlan =
        cards !== undefined || Object.keys(patch).some((k) => k !== 'status');
      if (isPlanLocked(workout) && changesPlan) {
        throw new ForbiddenException(
          workout.programEnrollmentId
            ? 'Only the status of a program workout can be changed'
            : 'Only the status of an assigned workout can be changed',
        );
      }

      if (cards !== undefined) {
        const existing = await loadCards(manager, id);
        assertOwnIds(existing, cards, 'self');
        await assertExercisesVisible(
          manager.getRepository(Exercise),
          cards.map((card) => card.exerciseId),
          ownerIdForVisibility(user),
        );
        await saveCardsInPlace(manager, id, existing, cards, 'self');
      }
      if (Object.keys(patch).length > 0) {
        await manager.update(Workout, { id }, patch);
      }
      if (cards !== undefined) await refreshTotal(manager, id);
      if (
        workout.programEnrollmentId &&
        patch.status === WorkoutStatus.COMPLETED
      ) {
        await completeEnrollmentIfDone(manager, workout.programEnrollmentId);
      }
    });

    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    await this.workoutRepo.manager.transaction(async (manager) => {
      const workout = await lockWorkout(manager, { id, userId: user.id });
      if (!workout) {
        throw new NotFoundException(`Workout with ID "${id}" not found`);
      }
      if (isPlanLocked(workout)) {
        throw new ForbiddenException(
          workout.programEnrollmentId
            ? 'A program workout is removed by abandoning its program'
            : 'An assigned workout can only be deleted by the coach',
        );
      }
      await manager.delete(Workout, { id });
    });
  }

  // Appends a set to a card of any own workout.
  async addSet(
    id: string,
    cardId: string,
    dto: AddSetDto,
    user: AuthUser,
  ): Promise<WorkoutSet> {
    return this.workoutRepo.manager.transaction(async (manager) => {
      const workout = await lockWorkout(manager, { id, userId: user.id });
      if (!workout) {
        throw new NotFoundException(`Workout with ID "${id}" not found`);
      }
      const card = await manager.findOne(WorkoutExercise, {
        where: { id: cardId, workoutId: id },
        relations: { sets: true },
      });
      if (!card) {
        throw new NotFoundException(`Card "${cardId}" not found on workout`);
      }

      const lastOrder = card.sets.reduce(
        (max, set) => Math.max(max, set.order),
        0,
      );
      const { identifiers } = await manager.insert(WorkoutSet, {
        workoutExerciseId: card.id,
        reps: dto.reps,
        weight: dto.weight ?? null,
        notes: null,
        made: dto.made ?? null,
        actualReps: dto.actualReps ?? null,
        actualWeight: dto.actualWeight ?? null,
        order: lastOrder + 1,
      });
      if (dto.made !== undefined && dto.made !== null) {
        await markStarted(manager, workout);
      }
      await refreshTotal(manager, id);
      return manager.findOneOrFail(WorkoutSet, {
        where: { id: identifiers[0].id as string },
      });
    });
  }

  // Logs the result of one set; planned values are never written here.
  async updateSetResult(
    id: string,
    setId: string,
    dto: SetResultDto,
    user: AuthUser,
  ): Promise<WorkoutSet> {
    return this.workoutRepo.manager.transaction(async (manager) => {
      const workout = await lockWorkout(manager, { id, userId: user.id });
      if (!workout) {
        throw new NotFoundException(`Workout with ID "${id}" not found`);
      }
      const set = await manager.findOne(WorkoutSet, {
        where: { id: setId, workoutExercise: { workoutId: id } },
      });
      if (!set) {
        throw new NotFoundException(`Set "${setId}" not found on workout`);
      }

      const results: Partial<WorkoutSet> = {};
      if (dto.made !== undefined) results.made = dto.made;
      if (dto.actualReps !== undefined) results.actualReps = dto.actualReps;
      if (dto.actualWeight !== undefined) {
        results.actualWeight = dto.actualWeight;
      }
      if (Object.keys(results).length > 0) {
        await manager.update(WorkoutSet, { id: setId }, results);
        await markStarted(manager, workout);
      }
      await refreshTotal(manager, id);
      return manager.findOneOrFail(WorkoutSet, { where: { id: setId } });
    });
  }

  private async toViews(workouts: Workout[]): Promise<Workout[]> {
    const names = await programNamesOf(this.workoutRepo.manager, workouts);
    return workouts.map((workout) => toWorkoutView(workout, names));
  }
}
