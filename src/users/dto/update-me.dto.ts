import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { WeightUnit } from '../../common/weight-unit';

export class UpdateMeDto {
  @ApiProperty({ enum: WeightUnit })
  @IsEnum(WeightUnit)
  weightUnit: WeightUnit;
}
