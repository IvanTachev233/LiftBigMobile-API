import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, Not, DeepPartial } from 'typeorm';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutExercise } from './entities/workout-exercise.entity';
import {
  CreateWorkoutDto,
  UpdateWorkoutDto,
  CreateExerciseDto,
  WorkoutExerciseInput,
} from './dto/workout.dto';
import { AuthUser } from '../auth/auth-user.interface';
import {
  isExerciseVisible,
  nameEqualsIgnoringCase,
  ownerIdForVisibility,
  visibleExerciseWhere,
} from './exercise-visibility.util';

const CARD_RELATIONS = ['exercises', 'exercises.exercise', 'exercises.sets'];

// Cards by order, then each card's sets by order.
function sortCards(workout: Workout): Workout {
  workout.exercises?.sort((a, b) => a.order - b.order);
  for (const card of workout.exercises ?? []) {
    card.sets?.sort((a, b) => a.order - b.order);
  }
  return workout;
}

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

  private async assertExercisesVisible(
    exerciseIds: string[],
    ownerId: string | null,
  ): Promise<void> {
    const uniqueIds = [...new Set(exerciseIds)];
    for (const exerciseId of uniqueIds) {
      const visible = await isExerciseVisible(
        this.exerciseRepo,
        exerciseId,
        ownerId,
      );
      if (!visible) {
        throw new BadRequestException(
          `Exercise "${exerciseId}" is not visible to you`,
        );
      }
    }
  }

  async create(
    createWorkoutDto: CreateWorkoutDto,
    user: AuthUser,
  ): Promise<Workout> {
    const workout = this.workoutRepo.create({
      ...createWorkoutDto,
      user,
      userId: user.id,
      status: WorkoutStatus.PLANNED,
    });
    const saved = await this.workoutRepo.save(workout);
    saved.exercises ??= [];
    return saved;
  }

  async findAll(user: AuthUser): Promise<Workout[]> {
    const workouts = await this.workoutRepo.find({
      where: { userId: user.id },
      order: { date: 'DESC' },
      relations: CARD_RELATIONS,
    });
    return workouts.map(sortCards);
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
    return workouts.map(sortCards);
  }

  async findOne(id: string, user: AuthUser): Promise<Workout> {
    const workout = await this.workoutRepo.findOne({
      where: { id, userId: user.id },
      relations: CARD_RELATIONS,
    });
    if (!workout)
      throw new NotFoundException(`Workout with ID "${id}" not found`);

    return sortCards(workout);
  }

  // A card id must be one of this workout's cards, and a set id one of that
  // same card's sets; each id may appear once. Anything else is rejected so
  // rows are never moved across workouts or cards.
  private assertOwnIds(workout: Workout, cards: WorkoutExerciseInput[]): void {
    const ownSetIdsByCard = new Map(
      workout.exercises.map((card) => [
        card.id,
        new Set(card.sets.map((set) => set.id)),
      ]),
    );
    const seenCardIds = new Set<string>();
    const seenSetIds = new Set<string>();

    for (const card of cards) {
      const ownSetIds = card.id ? ownSetIdsByCard.get(card.id) : undefined;
      if (card.id && (!ownSetIds || seenCardIds.has(card.id))) {
        throw new BadRequestException(
          `Card "${card.id}" is not a card of this workout`,
        );
      }
      if (card.id) seenCardIds.add(card.id);

      for (const set of card.sets) {
        if (!set.id) continue;
        if (!ownSetIds?.has(set.id) || seenSetIds.has(set.id)) {
          throw new BadRequestException(
            `Set "${set.id}" is not a set of this card`,
          );
        }
        seenSetIds.add(set.id);
      }
    }
  }

  async update(
    id: string,
    updateWorkoutDto: UpdateWorkoutDto,
    user: AuthUser,
  ): Promise<Workout> {
    const workout = await this.findOne(id, user);

    const { exercises: cards, date, ...fields } = updateWorkoutDto;
    // DTO instances carry unset fields as own `undefined` properties
    const patch: DeepPartial<Workout> = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    if (date !== undefined) patch.date = new Date(date);

    if (cards !== undefined) {
      this.assertOwnIds(workout, cards);
      await this.assertExercisesVisible(
        cards.map((card) => card.exerciseId),
        ownerIdForVisibility(user),
      );

      // Total volume: weight × reps over every set of every card
      patch.totalWeightLifted = cards.reduce(
        (sum, card) =>
          sum +
          card.sets.reduce(
            (setSum, set) =>
              setSum + (Number(set.weight) || 0) * (Number(set.reps) || 0),
            0,
          ),
        0,
      );
    }

    await this.workoutRepo.manager.transaction(async (manager) => {
      if (cards !== undefined) {
        // Replace all cards (their sets go with them); own ids are reused.
        await manager.delete(WorkoutExercise, { workoutId: id });
        const rows = cards.map((card) =>
          manager.create(WorkoutExercise, {
            id: card.id,
            workoutId: id,
            exerciseId: card.exerciseId,
            order: card.order,
            supersetGroup: card.supersetGroup ?? null,
            sets: card.sets.map((set, i) => ({
              id: set.id,
              reps: set.reps,
              weight: set.weight,
              order: set.order ?? i + 1,
              isCompleted: set.isCompleted ?? false,
            })),
          }),
        );
        await manager.save(WorkoutExercise, rows);
      }
      if (Object.keys(patch).length > 0) {
        await manager.update(Workout, { id, userId: user.id }, patch);
      }
    });

    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const result = await this.workoutRepo.delete({ id, userId: user.id });
    if (result.affected === 0) {
      throw new NotFoundException(`Workout with ID "${id}" not found`);
    }
  }
}
