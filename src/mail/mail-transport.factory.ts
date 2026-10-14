import { LogMailTransport } from './log-mail.transport';
import { MailService } from './mail.service';
import { MailtrapMailTransport } from './mailtrap-mail.transport';
import { ResendMailTransport } from './resend-mail.transport';

// A Mailtrap sandbox inbox when MAILTRAP_API_TOKEN is set (local testing),
// else Resend when MAIL_PROVIDER_KEY is set, otherwise the log. Both
// providers need MAIL_FROM; Mailtrap also needs MAILTRAP_INBOX_ID.
export function createMailTransport(
  env: (name: string) => string | undefined,
): MailService {
  const mailtrapToken = env('MAILTRAP_API_TOKEN');
  const key = env('MAIL_PROVIDER_KEY');
  if (!mailtrapToken && !key) return new LogMailTransport();

  const from = env('MAIL_FROM');
  if (!from) {
    throw new Error(
      `MAIL_FROM must be set when ${mailtrapToken ? 'MAILTRAP_API_TOKEN' : 'MAIL_PROVIDER_KEY'} is set`,
    );
  }
  if (mailtrapToken) {
    const inboxId = env('MAILTRAP_INBOX_ID');
    if (!inboxId) {
      throw new Error(
        'MAILTRAP_INBOX_ID must be set when MAILTRAP_API_TOKEN is set',
      );
    }
    return new MailtrapMailTransport(mailtrapToken, inboxId, from);
  }
  return new ResendMailTransport(key!, from);
}
