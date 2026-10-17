import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { EmailCode } from './email-code.entity';
import { EmailCodeService } from './email-code.service';

@Module({
  imports: [TypeOrmModule.forFeature([EmailCode]), MailModule],
  providers: [EmailCodeService],
  exports: [EmailCodeService],
})
export class EmailCodesModule {}
