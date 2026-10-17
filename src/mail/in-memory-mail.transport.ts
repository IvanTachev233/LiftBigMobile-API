import { MailMessage, MailService } from './mail.service';

// Keeps sent mails in memory, oldest first; for tests
export class InMemoryMailTransport extends MailService {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push({ ...message });
    return Promise.resolve();
  }

  /** The newest mail sent to this address */
  lastTo(to: string): MailMessage | undefined {
    return this.sent.filter((mail) => mail.to === to).at(-1);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
