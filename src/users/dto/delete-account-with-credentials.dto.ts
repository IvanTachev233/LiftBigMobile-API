import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountWithCredentialsDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string;

  // JSON true from the page's confirm step; a plain form post can't send it
  @ApiProperty({ enum: [true] })
  @Equals(true)
  confirm: true;
}
