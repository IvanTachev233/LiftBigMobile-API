import {
  IsString,
  IsDateString,
  IsOptional,
  IsNumber,
  IsInt,
  IsUUID,
  IsBoolean,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// One set inside a card, as sent by the coach editor
export class ProgramSetDto {
  @ApiProperty()
  @IsInt()
  reps: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  weight?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  // Set number inside its card
  @ApiProperty()
  @IsInt()
  order: number;
}

// Sets sent back by the coach editor carry their id so they are updated in
// place and keep the client's result
export class UpdateProgramSetDto extends ProgramSetDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;
}

export class CreateProgramExerciseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exerciseId: string;

  // Position of the card in the program
  @ApiProperty()
  @IsInt()
  order: number;

  // Cards sharing the same value form one superset
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  supersetGroup?: string | null;

  @ApiProperty({ type: () => [ProgramSetDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramSetDto)
  sets: ProgramSetDto[];
}

export class UpdateProgramExerciseDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exerciseId: string;

  @ApiProperty()
  @IsInt()
  order: number;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  supersetGroup?: string | null;

  @ApiProperty({ type: () => [UpdateProgramSetDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProgramSetDto)
  sets: UpdateProgramSetDto[];
}

export class CreateProgramDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  scheduledDate: string;

  @ApiProperty({ type: () => [CreateProgramExerciseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProgramExerciseDto)
  exercises: CreateProgramExerciseDto[];
}

export class UpdateProgramDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  // When present, replaces the program's cards; cards and sets keep their id
  @ApiPropertyOptional({ type: () => [UpdateProgramExerciseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProgramExerciseDto)
  exercises?: UpdateProgramExerciseDto[];
}

// Client adds a set to one of the program's cards
export class AddProgramSetDto {
  @ApiProperty()
  @IsInt()
  reps: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  weight?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  made?: boolean | null;
}

// Client logs a result or edits one of the program's sets
export class PatchProgramSetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  reps?: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  weight?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  made?: boolean | null;
}
