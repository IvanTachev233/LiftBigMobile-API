import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { MAX_REST_SECONDS } from '../../common/rest-seconds';
import { WeightUnit } from '../../common/weight-unit';

// Each field may be left out; null is checked (and rejected) like any value
export class UpdateMeDto {
  @ApiPropertyOptional({ enum: WeightUnit })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(WeightUnit)
  weightUnit?: WeightUnit;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_REST_SECONDS })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_REST_SECONDS)
  restSeconds?: number;
}
