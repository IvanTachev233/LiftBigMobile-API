import {
  IsString,
  IsDateString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsNotEmpty,
  IsUUID,
  IsUrl,
  IsArray,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
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

// `{ exercise: { id } }` form of a set's exercise reference
export class ExerciseRefInput {
  @IsUUID()
  id: string;
}

// Set shape sent by the workout logger
export class WorkoutSetInput {
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  // Used when exerciseId is absent; a malformed id gives a 400
  @IsOptional()
  @ValidateNested()
  @Type(() => ExerciseRefInput)
  exercise?: ExerciseRefInput;

  @IsNumber()
  weight: number;

  @IsNumber()
  reps: number;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  // Sets sharing the same value form one superset.
  @IsOptional()
  @IsUUID()
  supersetGroup?: string;
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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetInput)
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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(['CH', 'BK', 'LG', 'SH', 'AR', 'CO', 'FB', 'OT'])
  bodyPart?: BodyPart;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  videoUrl?: string;
}
