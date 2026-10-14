import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMailTransport } from './mail-transport.factory';
import { MailService } from './mail.service';

@Module({
  providers: [
    {
      provide: MailService,
      useFactory: (config: ConfigService) =>
        createMailTransport((name) => config.get<string>(name)),
      inject: [ConfigService],
    },
  ],
  exports: [MailService],
})
export class MailModule {}
