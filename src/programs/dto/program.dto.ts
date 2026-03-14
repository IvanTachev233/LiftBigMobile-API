import {
  IsString,
  IsDateString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsBoolean,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProgramExerciseDto {
  @IsUUID()
  exerciseId: string;

  @IsNumber()
  reps: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsNumber()
  order: number;
}

export class CreateProgramDto {
  @IsUUID()
  clientId: string;

  @IsString()
  name: string;

  @IsDateString()
  scheduledDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProgramExerciseDto)
  exercises: CreateProgramExerciseDto[];
}

export class UpdateProgramDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProgramExerciseDto)
  exercises?: CreateProgramExerciseDto[];
}

export class AddExerciseSetDto {
  @IsUUID()
  exerciseId: string;

  @IsNumber()
  reps: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  made?: boolean | null;
}

export class PatchProgramExerciseDto {
  @IsOptional()
  @IsNumber()
  reps?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  made?: boolean | null;
}
