import { Logger } from '@nestjs/common';
import { MailMessage, MailService } from './mail.service';

// Writes mails to the log instead of sending them (no provider key set)
export class LogMailTransport extends MailService {
  private readonly logger = new Logger('Mail');

  send({ to, subject, text }: MailMessage): Promise<void> {
    this.logger.log(`To: ${to}\nSubject: ${subject}\n\n${text}`);
    return Promise.resolve();
  }
}
