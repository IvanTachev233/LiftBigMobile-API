import { Logger } from '@nestjs/common';
import { MailMessage, MailService } from './mail.service';

const SANDBOX_URL = 'https://sandbox.api.mailtrap.io/api/send';
const TIMEOUT_MS = 10_000;

// Delivers into a Mailtrap sandbox inbox (for testing; nothing reaches the
// recipient). Fails like the Resend transport; the token is never logged.
export class MailtrapMailTransport extends MailService {
  private readonly logger = new Logger('Mail');

  constructor(
    private readonly apiToken: string,
    private readonly inboxId: string,
    private readonly from: string,
  ) {
    super();
  }

  async send({ to, subject, text, html }: MailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `${SANDBOX_URL}/${encodeURIComponent(this.inboxId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
            // Requests without a client User-Agent may be blocked
            'User-Agent': 'liftbig-api',
          },
          body: JSON.stringify({
            from: senderAddress(this.from),
            to: [{ email: to }],
            subject,
            text,
            html,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Mail request failed: ${reason}`);
      throw new Error('Mail request failed');
    }

    if (!response.ok) {
      const reason = await errorMessage(response);
      this.logger.error(`Mail provider answered ${response.status}: ${reason}`);
      throw new Error(`Mail provider answered ${response.status}`);
    }
  }
}

// "Name <email>" or a bare address
function senderAddress(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  return match[1]
    ? { email: match[2].trim(), name: match[1] }
    : { email: match[2].trim() };
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { errors?: unknown };
    if (Array.isArray(parsed.errors)) return parsed.errors.join('; ');
  } catch {
    // Not JSON; fall through to the raw body
  }
  return body.slice(0, 200);
}
