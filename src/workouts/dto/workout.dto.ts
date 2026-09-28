import {
  IsString,
  IsDateString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
} from 'class-validator';
import { WorkoutStatus } from '../entities/workout.entity';
import { BodyPart } from '../entities/exercise.entity';

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

// Set shape sent by the workout logger; not validated beyond being present
export interface WorkoutSetInput {
  exerciseId?: string;
  exercise?: { id: string };
  weight: number;
  reps: number;
  order?: number;
  isCompleted?: boolean;
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
  sets?: WorkoutSetInput[];
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
