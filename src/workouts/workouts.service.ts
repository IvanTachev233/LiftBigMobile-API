import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, Not } from 'typeorm';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import { CreateWorkoutDto, UpdateWorkoutDto } from './dto/workout.dto';
import { User } from '../auth/user.entity';

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

  async findAllExercises(): Promise<Exercise[]> {
    return this.exerciseRepo.find({ order: { name: 'ASC' } });
  }

  async create(
    createWorkoutDto: CreateWorkoutDto,
    user: User,
  ): Promise<Workout> {
    const workout = this.workoutRepo.create({
      ...createWorkoutDto,
      user,
      userId: user.id,
      status: WorkoutStatus.PLANNED,
    });
    return this.workoutRepo.save(workout);
  }

  async findAll(user: User): Promise<Workout[]> {
    return this.workoutRepo.find({
      where: { userId: user.id },
      order: { date: 'DESC' },
      relations: ['sets', 'sets.exercise'],
    });
  }

  async findUpcoming(user: User): Promise<Workout[]> {
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

  async findOne(id: string, user: User): Promise<Workout> {
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
    user: User,
  ): Promise<Workout> {
    const workout = await this.findOne(id, user);

    const { sets: incomingSets, ...workoutFields } = updateWorkoutDto;
    Object.assign(workout, workoutFields);

    if (incomingSets !== undefined) {
      // Remove existing sets
      await this.setRepo.delete({ workoutId: id });

      // Create new sets with proper workoutId
      const newSets = incomingSets.map((s: any, i: number) =>
        this.setRepo.create({
          workoutId: id,
          exerciseId: s.exerciseId || s.exercise?.id,
          weight: s.weight,
          reps: s.reps,
          order: s.order ?? i + 1,
          isCompleted: s.isCompleted ?? false,
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

  async remove(id: string, user: User): Promise<void> {
    const result = await this.workoutRepo.delete({ id, userId: user.id });
    if (result.affected === 0) {
      throw new NotFoundException(`Workout with ID "${id}" not found`);
    }
  }
}
