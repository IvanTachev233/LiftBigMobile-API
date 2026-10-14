import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource, FindOperator } from 'typeorm';
import { User } from '../auth/user.entity';
import { InMemoryMailTransport } from '../mail/in-memory-mail.transport';
import { MailMessage, MailService } from '../mail/mail.service';
import { EmailCode, EmailCodePurpose } from './email-code.entity';
import { EmailCodeService } from './email-code.service';

type Row = Record<string, unknown>;

const USER = { id: randomUUID(), email: 'lifter@example.com' };
const MINUTE = 60_000;

// In-memory email_code table behind the EntityManager calls the service
// makes. A transaction restores the table when its callback throws.
function fakeDataSource() {
  let rows: Row[] = [];
  const locks: { entity: string; mode?: string }[] = [];

  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, expected]) => {
      if (expected instanceof FindOperator) {
        const value = (row[key] as Date).getTime();
        const bound = (expected.value as Date).getTime();
        if (expected.type === 'moreThan') return value > bound;
        if (expected.type === 'lessThanOrEqual') return value <= bound;
        throw new Error(`Unsupported operator ${expected.type}`);
      }
      return row[key] === expected;
    });

  const newestFirst = (a: Row, b: Row) =>
    (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime();

  const check = (target: unknown) => {
    if (target !== EmailCode) throw new Error('Only email_code is faked');
  };

  const manager = {
    findOne: (
      target: unknown,
      options: { where: Row; lock?: { mode: string } },
    ) => {
      locks.push({
        entity: (target as { name: string }).name,
        mode: options.lock?.mode,
      });
      if (target === User) {
        return Promise.resolve(
          options.where.id === USER.id ? { id: USER.id } : null,
        );
      }
      check(target);
      const found = rows
        .filter((r) => matches(r, options.where))
        .sort(newestFirst);
      return Promise.resolve(found[0] ? { ...found[0] } : null);
    },
    find: (target: unknown, options: { where: Row }) => {
      check(target);
      return Promise.resolve(
        rows
          .filter((r) => matches(r, options.where))
          .sort(newestFirst)
          .map((r) => ({ ...r })),
      );
    },
    insert: (target: unknown, values: Row) => {
      check(target);
      rows.push({ id: randomUUID(), attempts: 0, usedAt: null, ...values });
      return Promise.resolve();
    },
    update: (target: unknown, id: string, values: Row) => {
      check(target);
      rows = rows.map((r) => (r.id === id ? { ...r, ...values } : r));
      return Promise.resolve();
    },
    delete: (target: unknown, where: Row) => {
      check(target);
      rows = rows.filter((r) => !matches(r, where));
      return Promise.resolve();
    },
  };

  const state = { openTransactions: 0 };
  const dataSource = {
    manager,
    transaction: async <T>(work: (m: typeof manager) => Promise<T>) => {
      const snapshot = rows.map((r) => ({ ...r }));
      state.openTransactions++;
      try {
        return await work(manager);
      } catch (error) {
        rows = snapshot;
        throw error;
      } finally {
        state.openTransactions--;
      }
    },
  };

  return {
    dataSource: dataSource as unknown as DataSource,
    rows: () => rows,
    locks,
    state,
  };
}

class FailingMailTransport extends MailService {
  send(): Promise<void> {
    return Promise.reject(new Error('provider down'));
  }
}

function setup(mail: MailService = new InMemoryMailTransport()) {
  const db = fakeDataSource();
  const config = { get: () => 'test-secret' } as unknown as ConfigService;
  const service = new EmailCodeService(db.dataSource, mail, config);
  return { ...db, service, mail };
}

function codeIn(mail: MailMessage): string {
  const match = /\b(\d{6})\b/.exec(mail.text);
  if (!match) throw new Error(`No code in ${mail.text}`);
  return match[1];
}

async function status(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected an HTTP error');
}

describe('EmailCodeService', () => {
  const start = Date.UTC(2026, 9, 14, 12, 0, 0);
  let now: number;

  beforeEach(() => {
    now = start;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const later = (ms: number) => {
    now += ms;
  };

  describe('issue', () => {
    it('mails a 6-digit code and stores only its hash', async () => {
      const { service, mail, rows } = setup();
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);

      const sent = (mail as InMemoryMailTransport).sent;
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(USER.email);
      const code = codeIn(sent[0]);
      expect(code).toMatch(/^\d{6}$/);
      expect(sent[0].html).toContain(code);

      expect(rows()).toHaveLength(1);
      const row = rows()[0];
      expect(row.userId).toBe(USER.id);
      expect(row.purpose).toBe(EmailCodePurpose.VERIFY_EMAIL);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(code);
    });

    it('expires codes 15 minutes after issue and says so in the mail', async () => {
      const { service, mail, rows } = setup();
      const { expiresAt } = await service.issue(
        USER,
        EmailCodePurpose.RESET_PASSWORD,
      );
      expect(expiresAt.getTime()).toBe(start + 15 * MINUTE);
      expect((rows()[0].expiresAt as Date).getTime()).toBe(start + 15 * MINUTE);
      const sent = (mail as InMemoryMailTransport).sent[0];
      expect(sent.text).toContain('15 minutes');
      expect(sent.text).toContain("If this wasn't you, ignore this email.");
      expect(sent.html).toContain('15 minutes');
      expect(sent.html).not.toMatch(/<a\b|<img\b/i);
    });

    it('locks the user row so concurrent requests count against one limit', async () => {
      const { service, locks } = setup();
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      expect(locks[0]).toEqual({ entity: 'User', mode: 'pessimistic_write' });
    });

    it('allows one request per 60 seconds per user and purpose', async () => {
      const { service } = setup();
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      later(20_000);

      const error = await status(
        service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
      );
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(error.getResponse()).toMatchObject({ retryAfterSeconds: 40 });

      // The other purpose has its own limit
      await service.issue(USER, EmailCodePurpose.RESET_PASSWORD);

      later(40_000);
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
    });

    it('allows 5 requests per hour per user and purpose', async () => {
      const { service } = setup();
      for (let i = 0; i < 5; i++) {
        await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
        later(2 * MINUTE);
      }
      // First request was 10 minutes ago; it leaves the window in 50
      const error = await status(
        service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
      );
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(error.getResponse()).toMatchObject({ retryAfterSeconds: 50 * 60 });

      later(50 * MINUTE);
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
    });

    it('counts used codes towards the hourly limit', async () => {
      const { service, mail } = setup();
      for (let i = 0; i < 5; i++) {
        await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
        const code = codeIn((mail as InMemoryMailTransport).sent[i]);
        await service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code);
        later(MINUTE);
      }
      const error = await status(
        service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
      );
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('drops rows that fell out of the hourly window', async () => {
      const { service, rows } = setup();
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      later(61 * MINUTE);
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      expect(rows()).toHaveLength(1);
      expect((rows()[0].createdAt as Date).getTime()).toBe(now);
    });

    it('stores no code when the mail cannot be sent (503)', async () => {
      const { service, rows } = setup(new FailingMailTransport());
      const error = await status(
        service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
      );
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(rows()).toEqual([]);
      // Nothing was counted either
      await expect(
        service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('keeps the previous code live when the replacement cannot be sent', async () => {
      const mail = new InMemoryMailTransport();
      const { service } = setup(mail);
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      const code = codeIn(mail.sent[0]);

      jest
        .spyOn(mail, 'send')
        .mockRejectedValueOnce(new Error('provider down'));
      later(MINUTE);
      await expect(
        service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      await service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code);
    });

    it('sends the mail only after the transaction has committed', async () => {
      const mail = new InMemoryMailTransport();
      const { service, state, rows } = setup(mail);
      const during: { open: number; stored: number }[] = [];
      jest.spyOn(mail, 'send').mockImplementation(() => {
        during.push({ open: state.openTransactions, stored: rows().length });
        return Promise.resolve();
      });
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      expect(during).toEqual([{ open: 0, stored: 1 }]);
    });

    it('holds off a second request while the first mail is being sent', async () => {
      const mail = new InMemoryMailTransport();
      const { service } = setup(mail);
      let second: HttpException | undefined;
      jest.spyOn(mail, 'send').mockImplementationOnce(async () => {
        second = await status(
          service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
        );
        throw new Error('provider down');
      });
      await expect(
        service.issue(USER, EmailCodePurpose.VERIFY_EMAIL),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(second?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('stops with a 404 before writing when the account is gone', async () => {
      const { service, rows, mail } = setup();
      const error = await status(
        service.issue(
          { id: randomUUID(), email: 'gone@example.com' },
          EmailCodePurpose.VERIFY_EMAIL,
        ),
      );
      expect(error).toBeInstanceOf(NotFoundException);
      expect(rows()).toEqual([]);
      expect((mail as InMemoryMailTransport).sent).toEqual([]);
    });
  });

  describe('verify', () => {
    async function issued() {
      const ctx = setup();
      await ctx.service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      const code = codeIn((ctx.mail as InMemoryMailTransport).sent[0]);
      const wrong = code === '000000' ? '111111' : '000000';
      return { ...ctx, code, wrong };
    }

    it('accepts the right code once', async () => {
      const { service, code, rows } = await issued();
      await service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code);
      expect(rows()[0].usedAt).toBeInstanceOf(Date);

      const again = await status(
        service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code),
      );
      expect(again).toBeInstanceOf(ConflictException);
    });

    it('only accepts the code for its purpose', async () => {
      const { service, code } = await issued();
      const error = await status(
        service.verify(USER.id, EmailCodePurpose.RESET_PASSWORD, code),
      );
      expect(error).toBeInstanceOf(ConflictException);
      await service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code);
    });

    it('counts attempts down on wrong codes and ends the code on the 5th', async () => {
      const { service, code, wrong } = await issued();
      for (const attemptsLeft of [4, 3, 2, 1]) {
        const error = await status(
          service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, wrong),
        );
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ attemptsLeft });
      }
      const fifth = await status(
        service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, wrong),
      );
      expect(fifth).toBeInstanceOf(ConflictException);

      // Even the right code no longer works
      const right = await status(
        service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code),
      );
      expect(right).toBeInstanceOf(ConflictException);
    });

    it('counts a malformed code as a wrong entry', async () => {
      const { service } = await issued();
      const error = await status(
        service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, '12ab'),
      );
      expect(error.getResponse()).toMatchObject({ attemptsLeft: 4 });
    });

    it('rejects an expired code with 409', async () => {
      const { service, code } = await issued();
      later(15 * MINUTE);
      const error = await status(
        service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code),
      );
      expect(error).toBeInstanceOf(ConflictException);
    });

    it('rejects with 409 when no code was issued', async () => {
      const { service } = setup();
      const error = await status(
        service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, '123456'),
      );
      expect(error).toBeInstanceOf(ConflictException);
    });

    it('replaces the old code with a new one', async () => {
      const { service, mail, code } = await issued();
      later(MINUTE);
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      const newCode = codeIn((mail as InMemoryMailTransport).sent[1]);

      if (newCode !== code) {
        const old = await status(
          service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code),
        );
        expect(old).toBeInstanceOf(BadRequestException);
      }
      await service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, newCode);
    });

    it('gives a new code a fresh set of attempts', async () => {
      const { service, mail, wrong } = await issued();
      for (let i = 0; i < 5; i++) {
        await status(
          service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, wrong),
        );
      }
      later(MINUTE);
      await service.issue(USER, EmailCodePurpose.VERIFY_EMAIL);
      const newCode = codeIn((mail as InMemoryMailTransport).sent[1]);
      const otherWrong = newCode === '000000' ? '111111' : '000000';
      const error = await status(
        service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, otherWrong),
      );
      expect(error.getResponse()).toMatchObject({ attemptsLeft: 4 });
    });

    it('locks the code row while checking it', async () => {
      const { service, code, locks } = await issued();
      locks.length = 0;
      await service.verify(USER.id, EmailCodePurpose.VERIFY_EMAIL, code);
      expect(locks).toEqual([
        { entity: 'EmailCode', mode: 'pessimistic_write' },
      ]);
    });
  });
});
