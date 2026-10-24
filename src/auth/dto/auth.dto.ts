import {
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  AcceptTermsDto,
  AgreementSourceDto,
  ConsentsDto,
} from '../../policies/dto/agreement.dto';

export class RegisterDto extends AgreementSourceDto {
  // Optional: builds before the name field didn't send one (they can't sign
  // up any more anyway, as acceptTerms is required)
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsEnum(['COACH', 'CLIENT'])
  role?: 'COACH' | 'CLIENT';

  // The current Terms and Privacy versions and the required consents; the
  // versions are checked by agreementItems
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AcceptTermsDto)
  acceptTerms: AcceptTermsDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentsDto)
  consents?: ConsentsDto;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;
}

export class VerifyEmailDto {
  @IsEmail()
  email: string;

  // Checked by the code service; a malformed code counts as a wrong one
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  // Checked by the code service; a malformed code counts as a wrong one
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  refresh_token: string;
}
