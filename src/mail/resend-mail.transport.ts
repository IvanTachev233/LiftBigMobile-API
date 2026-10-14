import { Logger } from '@nestjs/common';
import { MailMessage, MailService } from './mail.service';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

// Sends through the Resend HTTP API. Any non-2xx answer, network error or
// timeout rejects; the log gets the status and Resend's message, never the key.
export class ResendMailTransport extends MailService {
  private readonly logger = new Logger('Mail');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    super();
  }

  async send({ to, subject, text, html }: MailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [to],
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Mail request failed: ${reason}`);
      throw new Error('Mail request failed');
    }

    if (!response.ok) {
      const reason = await this.errorMessage(response);
      this.logger.error(`Mail provider answered ${response.status}: ${reason}`);
      throw new Error(`Mail provider answered ${response.status}`);
    }
  }

  private async errorMessage(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    try {
      const parsed = JSON.parse(body) as { message?: unknown };
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // Not JSON; fall through to the raw body
    }
    return body.slice(0, 200);
  }
}
