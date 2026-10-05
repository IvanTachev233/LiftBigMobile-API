import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutsService } from './workouts.service';
import { WorkoutsController } from './workouts.controller';
import { Workout } from './entities/workout.entity';
import { WorkoutExercise } from './entities/workout-exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import { Exercise } from './entities/exercise.entity';
import { CoachWorkoutsController } from './coach-workouts.controller';
import { CoachWorkoutsService } from './coach-workouts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workout, WorkoutExercise, WorkoutSet, Exercise]),
  ],
  controllers: [WorkoutsController, CoachWorkoutsController],
  providers: [WorkoutsService, CoachWorkoutsService],
})
export class WorkoutsModule {}
