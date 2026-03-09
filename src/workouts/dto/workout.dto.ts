import {
  IsString,
  IsDateString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkoutStatus } from '../entities/workout.entity';
import { WeightMode } from '../entities/workout-set.entity';

import { BodyPart } from '../entities/exercise.entity';

// Fix imports - WorkoutStatus is in workout.entity.ts, BodyPart in exercise.entity.ts
// Re-exporting them in DTO file or Importing correctly.
// Let's rely on the entity files.

export class CreateWorkoutDto {
  @IsDateString()
  date: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;
}

export class UpdateWorkoutDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(['PLANNED', 'IN_PROGRESS', 'COMPLETED'])
  status?: WorkoutStatus;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  sets?: any[];
}

export class LogSetDto {
  @IsNumber()
  reps: number;

  @IsNumber()
  weight: number;

  @IsBoolean()
  isCompleted: boolean;
}

export class CreateExerciseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['CH', 'BK', 'LG', 'SH', 'AR', 'CO', 'FB', 'OT'])
  bodyPart?: BodyPart;
}
