import { LogMailTransport } from './log-mail.transport';
import { MailService } from './mail.service';
import { ResendMailTransport } from './resend-mail.transport';

// Resend when MAIL_PROVIDER_KEY is set (MAIL_FROM is then required),
// otherwise the log.
export function createMailTransport(
  env: (name: string) => string | undefined,
): MailService {
  const key = env('MAIL_PROVIDER_KEY');
  if (!key) return new LogMailTransport();
  const from = env('MAIL_FROM');
  if (!from) {
    throw new Error('MAIL_FROM must be set when MAIL_PROVIDER_KEY is set');
  }
  return new ResendMailTransport(key, from);
}
