import {
  IsString,
  IsDateString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsInt,
  IsNotEmpty,
  IsUUID,
  IsUrl,
  IsArray,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

// One set inside a card. `id` keeps an existing set of the same card.
export class WorkoutSetInput {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing set id of the same card; omit for a new set',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ type: 'integer' })
  @IsInt()
  reps: number;

  @ApiProperty()
  @IsNumber()
  weight: number;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Set number inside the card; defaults to its position',
  })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;
}

// One exercise card. `id` keeps an existing card of the same workout.
export class WorkoutExerciseInput {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing card id of this workout; omit for a new card',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exerciseId: string;

  @ApiProperty({ type: 'integer', description: 'Card position' })
  @IsInt()
  order: number;

  // Cards sharing the same value form one superset.
  @ApiPropertyOptional({ format: 'uuid', type: 'string', nullable: true })
  @IsOptional()
  @IsUUID()
  supersetGroup?: string | null;

  @ApiProperty({ type: () => [WorkoutSetInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetInput)
  sets: WorkoutSetInput[];
}

export class UpdateWorkoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] })
  @IsOptional()
  @IsEnum(['PLANNED', 'IN_PROGRESS', 'COMPLETED'])
  status?: WorkoutStatus;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  date?: string;

  // When present, replaces all of the workout's cards; when absent, the
  // cards are left as they are.
  @ApiPropertyOptional({
    type: () => [WorkoutExerciseInput],
    description: 'Replaces all cards when present',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseInput)
  exercises?: WorkoutExerciseInput[];
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
