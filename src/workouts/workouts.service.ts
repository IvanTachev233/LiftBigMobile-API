import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, Not } from 'typeorm';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import {
  CreateWorkoutDto,
  UpdateWorkoutDto,
  CreateExerciseDto,
} from './dto/workout.dto';
import { AuthUser } from '../auth/auth-user.interface';
import {
  isExerciseVisible,
  nameEqualsIgnoringCase,
  ownerIdForVisibility,
  visibleExerciseWhere,
} from './exercise-visibility.util';

@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(Workout)
    private workoutRepo: Repository<Workout>,
    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,
    @InjectRepository(WorkoutSet)
    private setRepo: Repository<WorkoutSet>,
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
    return this.workoutRepo.save(workout);
  }

  async findAll(user: AuthUser): Promise<Workout[]> {
    return this.workoutRepo.find({
      where: { userId: user.id },
      order: { date: 'DESC' },
      relations: ['sets', 'sets.exercise'],
    });
  }

  async findUpcoming(user: AuthUser): Promise<Workout[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.workoutRepo.find({
      where: {
        userId: user.id,
        date: MoreThanOrEqual(today),
        status: Not(WorkoutStatus.COMPLETED),
      },
      relations: ['sets', 'sets.exercise'], // We might need exercises to show what's in the workout
      order: { date: 'ASC' },
    });
  }

  async findOne(id: string, user: AuthUser): Promise<Workout> {
    const workout = await this.workoutRepo.findOne({
      where: { id, userId: user.id },
      relations: ['sets', 'sets.exercise'],
    });
    if (!workout)
      throw new NotFoundException(`Workout with ID "${id}" not found`);

    return workout;
  }

  async update(
    id: string,
    updateWorkoutDto: UpdateWorkoutDto,
    user: AuthUser,
  ): Promise<Workout> {
    const workout = await this.findOne(id, user);

    const { sets: incomingSets, ...workoutFields } = updateWorkoutDto;
    Object.assign(workout, workoutFields);

    if (incomingSets !== undefined) {
      const exerciseIds = incomingSets
        .map((s) => s.exerciseId || s.exercise?.id)
        .filter((v): v is string => !!v);
      await this.assertExercisesVisible(
        exerciseIds,
        ownerIdForVisibility(user),
      );

      // Remove existing sets
      await this.setRepo.delete({ workoutId: id });

      // Create new sets with proper workoutId
      const newSets = incomingSets.map((s, i) =>
        this.setRepo.create({
          workoutId: id,
          exerciseId: s.exerciseId || s.exercise?.id,
          weight: s.weight,
          reps: s.reps,
          order: s.order ?? i + 1,
          isCompleted: s.isCompleted ?? false,
          supersetGroup: s.supersetGroup ?? null,
        }),
      );
      workout.sets = await this.setRepo.save(newSets);

      // Calculate total volume (weight × reps for each set)
      workout.totalWeightLifted = workout.sets.reduce(
        (sum, set) => sum + (Number(set.weight) || 0) * (Number(set.reps) || 0),
        0,
      );
    }

    return this.workoutRepo.save(workout);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const result = await this.workoutRepo.delete({ id, userId: user.id });
    if (result.affected === 0) {
      throw new NotFoundException(`Workout with ID "${id}" not found`);
    }
  }
}
