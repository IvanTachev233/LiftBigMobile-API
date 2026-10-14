import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  // Optional so older app builds that don't send a name can still register
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
