import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../common/is-calendar-date.decorator';
import { MAX_WEIGHT_KG } from '../../lifts/dto/lift.dto';

// A 1RM entered for a lift, in kg.
export class MaxInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exerciseId: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  @Max(MAX_WEIGHT_KG)
  weightKg: number;
}

export class RecalculateEnrollmentDto {
  @ApiProperty({ type: [MaxInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaxInput)
  maxes: MaxInput[];
}

export class CreateEnrollmentDto extends RecalculateEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  programId: string;

  @ApiProperty({
    format: 'date',
    description: 'First session date in the device calendar',
  })
  @IsCalendarDate()
  startDate: string;

  @ApiPropertyOptional({
    description: 'Abandon the active program instead of returning 409',
  })
  @IsOptional()
  @IsBoolean()
  abandonCurrent?: boolean;
}
