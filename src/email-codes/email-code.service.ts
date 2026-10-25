import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { DataSource, LessThanOrEqual, MoreThan } from 'typeorm';
import { jwtSecret } from '../auth/jwt-secret';
import { User } from '../auth/user.entity';
import { MailService } from '../mail/mail.service';
import { emailCodeMail } from './email-code-mail';
import { EmailCode, EmailCodePurpose } from './email-code.entity';

export const CODE_VALID_MINUTES = 15;
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_COOLDOWN_SECONDS = 60;
export const MAX_CODES_PER_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;

type VerifyOutcome = { ok: true } | { gone: true } | { attemptsLeft: number };

@Injectable()
export class EmailCodeService {
  private readonly secret: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.secret = jwtSecret(config);
  }

  /**
   * Mails the user a new code for this purpose, replacing any earlier one.
   * At most one request per 60 s and 5 per hour per user and purpose (429
   * with retryAfterSeconds). A failed send is a 503 and stores nothing, so
   * the previous code stays valid. An account that no longer exists is a 404.
   */
  async issue(
    user: Pick<User, 'id' | 'email'>,
    purpose: EmailCodePurpose,
  ): Promise<{ expiresAt: Date }> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      // Serialises requests for this user across instances
      const locked = await manager.findOne(User, {
        where: { id: user.id },
        select: { id: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) return { missing: true } as const;

      const now = Date.now();
      const windowStart = new Date(now - HOUR_MS);
      await manager.delete(EmailCode, {
        userId: user.id,
        purpose,
        createdAt: LessThanOrEqual(windowStart),
      });
      const recent = await manager.find(EmailCode, {
        where: { userId: user.id, purpose, createdAt: MoreThan(windowStart) },
        order: { createdAt: 'DESC' },
      });
      const retryAfterSeconds = this.retryAfterSeconds(recent, now);
      if (retryAfterSeconds > 0) return { retryAfterSeconds };

      const id = randomUUID();
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = new Date(now + CODE_VALID_MINUTES * 60_000);
      await manager.insert(EmailCode, {
        id,
        userId: user.id,
        purpose,
        codeHash: this.hash(user.id, purpose, code),
        expiresAt,
        createdAt: new Date(now),
      });
      return { id, code, expiresAt };
    });

    if ('missing' in outcome) {
      throw new NotFoundException('Account not found');
    }
    if ('retryAfterSeconds' in outcome) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many codes requested. Try again in ${outcome.retryAfterSeconds} s.`,
          retryAfterSeconds: outcome.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Sent after the commit, so no lock is held during the provider call;
    // the committed row already holds off concurrent requests.
    try {
      await this.mail.send(
        emailCodeMail(user.email, purpose, outcome.code, CODE_VALID_MINUTES),
      );
    } catch {
      // Neither stored nor counted; the previous code is the newest again
      await this.dataSource.manager.delete(EmailCode, { id: outcome.id });
      throw new ServiceUnavailableException(
        'The email could not be sent. Try again later.',
      );
    }
    return { expiresAt: outcome.expiresAt };
  }

  /**
   * Resolves when the code matches the user's newest code for this purpose,
   * and uses it up. A wrong code is a 400 with attemptsLeft; the 5th wrong
   * entry, or a code that is used, expired or was never issued, is a 409
   * (a new code is needed).
   */
  async verify(
    userId: string,
    purpose: EmailCodePurpose,
    code: string,
  ): Promise<void> {
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<VerifyOutcome> => {
        const row = await manager.findOne(EmailCode, {
          where: { userId, purpose },
          order: { createdAt: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });
        const now = Date.now();
        if (
          !row ||
          row.usedAt ||
          row.expiresAt.getTime() <= now ||
          row.attempts >= MAX_CODE_ATTEMPTS
        ) {
          return { gone: true };
        }

        if (this.matches(row.codeHash, userId, purpose, code)) {
          await manager.update(EmailCode, row.id, { usedAt: new Date(now) });
          return { ok: true };
        }

        const attempts = row.attempts + 1;
        await manager.update(EmailCode, row.id, { attempts });
        if (attempts >= MAX_CODE_ATTEMPTS) return { gone: true };
        return { attemptsLeft: MAX_CODE_ATTEMPTS - attempts };
      },
    );

    if ('gone' in outcome) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: 'This code is no longer valid. Request a new one.',
      });
    }
    if ('attemptsLeft' in outcome) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Wrong code',
        attemptsLeft: outcome.attemptsLeft,
      });
    }
  }

  // Seconds until both the cooldown and the hourly limit allow a request;
  // recent is newest first and covers the last hour.
  private retryAfterSeconds(recent: EmailCode[], now: number): number {
    let waitMs = 0;
    if (recent.length > 0) {
      const sinceLast = now - recent[0].createdAt.getTime();
      waitMs = Math.max(waitMs, CODE_COOLDOWN_SECONDS * 1000 - sinceLast);
    }
    if (recent.length >= MAX_CODES_PER_HOUR) {
      const oldestCounted = recent[MAX_CODES_PER_HOUR - 1];
      waitMs = Math.max(
        waitMs,
        oldestCounted.createdAt.getTime() + HOUR_MS - now,
      );
    }
    return Math.ceil(waitMs / 1000);
  }

  // Keyed with the server secret: a leaked table alone can't be brute-forced
  private hash(userId: string, purpose: EmailCodePurpose, code: string) {
    return createHmac('sha256', this.secret)
      .update(`${userId}:${purpose}:${code}`)
      .digest('hex');
  }

  private matches(
    stored: string,
    userId: string,
    purpose: EmailCodePurpose,
    code: string,
  ): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const expected = Buffer.from(stored, 'hex');
    const actual = Buffer.from(this.hash(userId, purpose, code), 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}
