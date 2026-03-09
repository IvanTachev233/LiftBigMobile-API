import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutsService } from './workouts.service';
import { WorkoutsController } from './workouts.controller';
import { Workout } from './entities/workout.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import { Exercise } from './entities/exercise.entity';
import { AuthModule } from '../auth/auth.module'; // Import AuthModule for Guard if needed, though Guard just needs Strategy which is loaded by Passport

@Module({
  imports: [TypeOrmModule.forFeature([Workout, WorkoutSet, Exercise])],
  controllers: [WorkoutsController],
  providers: [WorkoutsService],
})
export class WorkoutsModule {}
