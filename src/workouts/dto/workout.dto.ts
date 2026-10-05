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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkoutStatus } from '../entities/workout.entity';
import { BodyPart } from '../entities/exercise.entity';
import { Forbidden } from '../../common/forbidden.decorator';

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

  @ApiProperty({ type: Number, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  weight: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Set number inside the card; defaults to its position',
  })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: 'true = made, false = missed, null = not logged',
  })
  @IsOptional()
  @IsBoolean()
  made?: boolean | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  @IsOptional()
  @IsInt()
  actualReps?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  actualWeight?: number | null;
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
  // Absent = unchanged; null is rejected, since these columns are required
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(['PLANNED', 'IN_PROGRESS', 'COMPLETED'])
  status?: WorkoutStatus;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  date?: string;

  // When present, cards and sets are updated in place by id, rows without
  // an id are created and rows left out are deleted; when absent, the cards
  // are left as they are.
  @ApiPropertyOptional({
    type: () => [WorkoutExerciseInput],
    description: 'Full card list when present; kept rows carry their id',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseInput)
  exercises?: WorkoutExerciseInput[];
}

// Client appends a set to a card of one of their workouts
export class AddSetDto {
  @ApiProperty({ type: 'integer' })
  @IsInt()
  reps: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  weight?: number | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  made?: boolean | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  @IsOptional()
  @IsInt()
  actualReps?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  actualWeight?: number | null;
}

// Client logs the result of one set; the planned values can't be changed
export class SetResultDto {
  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: 'true = made, false = missed, null = not logged',
  })
  @IsOptional()
  @IsBoolean()
  made?: boolean | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  @IsOptional()
  @IsInt()
  actualReps?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  actualWeight?: number | null;

  @Forbidden()
  reps?: never;

  @Forbidden()
  weight?: never;

  @Forbidden()
  notes?: never;
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
