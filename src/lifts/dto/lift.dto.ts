import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { IsCalendarDate } from '../../common/is-calendar-date.decorator';

// Largest value a numeric(6,2) weight column holds.
export const MAX_WEIGHT_KG = 9999.99;

export class BestLiftsQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated exercise ids; omit for every best lift',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsUUID(undefined, { each: true })
  exerciseIds?: string[];
}

export class CreateRepMaxDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exerciseId: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 3 })
  @IsInt()
  @Min(1)
  @Max(3)
  reps: number;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  @Max(MAX_WEIGHT_KG)
  weightKg: number;

  @ApiProperty({ format: 'date' })
  @IsCalendarDate()
  achievedOn: string;
}
