import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgreementSource } from '../policy-versions';

// Versions are checked against the current ones by agreementItems
export class AcceptTermsDto {
  @ApiPropertyOptional({ example: '2026-10-21' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  terms?: string;

  @ApiPropertyOptional({ example: '2026-10-21' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  privacy?: string;
}

export class ConsentChoiceDto {
  @ApiProperty()
  @IsBoolean()
  granted: boolean;

  // The version of the wording the user saw
  @ApiProperty({ example: '2026-10-21' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  textVersion: string;
}

// One optional entry per purpose; other keys are dropped
export class ConsentsDto {
  @ApiPropertyOptional({ type: ConsentChoiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentChoiceDto)
  health_data?: ConsentChoiceDto;

  @ApiPropertyOptional({ type: ConsentChoiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentChoiceDto)
  video_training?: ConsentChoiceDto;

  @ApiPropertyOptional({ type: ConsentChoiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentChoiceDto)
  product_emails?: ConsentChoiceDto;
}

// Where the agreement came from; app when not said
export class AgreementSourceDto {
  @ApiPropertyOptional({ enum: AgreementSource })
  @IsOptional()
  @IsEnum(AgreementSource)
  source?: AgreementSource;

  // The Android versionCode of the sending app
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2100000000)
  appVersionCode?: number;
}

// The update screen: what the user accepted and chose there
export class RecordAcceptancesDto extends AgreementSourceDto {
  @ApiPropertyOptional({ type: AcceptTermsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AcceptTermsDto)
  acceptTerms?: AcceptTermsDto;

  @ApiPropertyOptional({ type: ConsentsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentsDto)
  consents?: ConsentsDto;
}

export class SetConsentDto extends ConsentChoiceDto {
  @ApiPropertyOptional({ enum: AgreementSource })
  @IsOptional()
  @IsEnum(AgreementSource)
  source?: AgreementSource;
}
