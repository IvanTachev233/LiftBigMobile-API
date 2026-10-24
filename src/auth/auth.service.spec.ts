import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { EmailCodePurpose } from '../email-codes/email-code.entity';
import { EmailCodeService } from '../email-codes/email-code.service';
import { PoliciesService } from '../policies/policies.service';
import {
  CONSENT_TEXT_VERSIONS,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '../policies/policy-versions';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { User } from './user.entity';
import { Invite } from './invite.entity';

type StoredUser = Partial<User> & { id: string; email: string };

const tooMany = () =>
  new HttpException(
    { statusCode: 429, retryAfterSeconds: 30 },
    HttpStatus.TOO_MANY_REQUESTS,
  );

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected an HTTP error');
}

describe('AuthService', () => {
  let service: AuthService;
  let users: StoredUser[];
  let codes: { issue: jest.Mock; verify: jest.Mock };
  let sessions: { start: jest.Mock; refresh: jest.Mock; revoke: jest.Mock };
  let repo: Record<string, jest.Mock>;
  let policies: { record: jest.Mock };

  beforeEach(async () => {
    users = [];
    const byEmail = (email: string) => users.find((u) => u.email === email);
    const queryBuilder = () => {
      let email = '';
      const qb = {
        addSelect: () => qb,
        where: (_sql: string, params: { email: string }) => {
          email = params.email;
          return qb;
        },
        getOne: () => Promise.resolve(byEmail(email) ?? null),
      };
      return qb;
    };
    repo = {
      create: jest.fn((values: Partial<User>) => ({ ...values })),
      save: jest.fn((user: StoredUser) => {
        if (!user.id && byEmail(user.email)) {
          return Promise.reject(
            Object.assign(new Error('dup'), { code: '23505' }),
          );
        }
        user.id ??= `id-${users.length + 1}`;
        users.push({ ...user, tokenVersion: 0, emailVerifiedAt: null });
        return Promise.resolve(user);
      }),
      delete: jest.fn((id: string) => {
        users = users.filter((u) => u.id !== id);
        return Promise.resolve();
      }),
      update: jest.fn((id: string, values: Partial<User>) => {
        users = users.map((u) => (u.id === id ? { ...u, ...values } : u));
        return Promise.resolve();
      }),
      createQueryBuilder: jest.fn(queryBuilder),
    };
    // Transactions run on the same in-memory users; findOne records its lock
    const manager = {
      findOne: jest.fn((_entity: unknown, options: { where: { id: string } }) =>
        Promise.resolve(users.find((u) => u.id === options.where.id) ?? null),
      ),
      update: jest.fn(
        (_entity: unknown, id: string, values: Partial<User>) =>
          repo.update(id, values) as Promise<void>,
      ),
      save: jest.fn((user: StoredUser) => repo.save(user) as Promise<User>),
    };
    repo.manager = {
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    } as unknown as jest.Mock;
    codes = {
      issue: jest.fn(() => Promise.resolve({ expiresAt: new Date() })),
      verify: jest.fn(() => Promise.resolve()),
    };
    policies = { record: jest.fn(() => Promise.resolve()) };
    sessions = {
      start: jest.fn((user: { id: string }) =>
        Promise.resolve(`refresh-${user.id}`),
      ),
      refresh: jest.fn(),
      revoke: jest.fn(() => Promise.resolve()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: getRepositoryToken(Invite), useValue: {} },
        { provide: EmailCodeService, useValue: codes },
        { provide: AuthSessionService, useValue: sessions },
        { provide: PoliciesService, useValue: policies },
        {
          provide: JwtService,
          useValue: {
            sign: (payload: { sub: string }) => `jwt-${payload.sub}`,
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  const addUser = async (
    email: string,
    verified: boolean,
    password = 'password123',
  ) => {
    const user: StoredUser = {
      id: `id-${email}`,
      email,
      name: 'Lifter',
      role: 'CLIENT',
      coachId: null,
      tokenVersion: 3,
      passwordHash: await bcrypt.hash(password, 4),
      emailVerifiedAt: verified ? new Date('2026-01-01') : null,
    };
    users.push(user);
    return user;
  };

  describe('register', () => {
    const dto = {
      name: 'Jane',
      email: 'jane@example.com',
      password: 'secret1',
      acceptTerms: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION },
      consents: {
        health_data: {
          granted: true,
          textVersion: CONSENT_TEXT_VERSIONS.health_data,
        },
      },
    };

    it('creates the account unverified, mails a code and returns no token', async () => {
      const result = await service.register(dto);
      expect(result).toEqual({
        verificationRequired: true,
        email: 'jane@example.com',
      });
      expect(users).toHaveLength(1);
      expect(users[0].emailVerifiedAt).toBeNull();
      expect(codes.issue).toHaveBeenCalledWith(
        expect.objectContaining({ id: users[0].id, email: dto.email }),
        EmailCodePurpose.VERIFY_EMAIL,
      );
    });

    it('records the accepted versions and consents with the new account', async () => {
      await service.register({ ...dto, appVersionCode: 4 });
      expect(policies.record).toHaveBeenCalledWith(
        expect.anything(),
        users[0].id,
        {
          documents: [
            { document: 'terms', version: TERMS_VERSION },
            { document: 'privacy', version: PRIVACY_VERSION },
          ],
          consents: [
            {
              purpose: 'health_data',
              granted: true,
              textVersion: CONSENT_TEXT_VERSIONS.health_data,
            },
          ],
        },
        expect.objectContaining({ appVersionCode: 4 }),
      );
    });

    it('refuses outdated terms with 400 before creating anything', async () => {
      const error = await caught(
        service.register({
          ...dto,
          acceptTerms: { terms: '2026-01-01', privacy: PRIVACY_VERSION },
        }),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(users).toEqual([]);
      expect(policies.record).not.toHaveBeenCalled();
      expect(codes.issue).not.toHaveBeenCalled();
    });

    it('rejects a taken email with 409 and sends nothing', async () => {
      await addUser(dto.email, false);
      const error = await caught(service.register(dto));
      expect(error).toBeInstanceOf(ConflictException);
      expect(codes.issue).not.toHaveBeenCalled();
    });

    it('removes the new account again when the mail cannot be sent', async () => {
      codes.issue.mockRejectedValueOnce(new ServiceUnavailableException());
      const error = await caught(service.register(dto));
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(users).toEqual([]);
    });
  });

  describe('verifyEmail', () => {
    it('marks the account verified and signs in on the right code', async () => {
      const user = await addUser('a@example.com', false);
      const result = await service.verifyEmail('a@example.com', '123456');
      expect(codes.verify).toHaveBeenCalledWith(
        user.id,
        EmailCodePurpose.VERIFY_EMAIL,
        '123456',
      );
      expect(result).toEqual({
        access_token: `jwt-${user.id}`,
        refresh_token: `refresh-${user.id}`,
      });
      expect(users[0].emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('passes on a wrong or spent code and leaves the account unverified', async () => {
      await addUser('a@example.com', false);
      codes.verify.mockRejectedValueOnce(
        new BadRequestException({ attemptsLeft: 2 }),
      );
      const wrong = await caught(service.verifyEmail('a@example.com', '1'));
      expect(wrong.getResponse()).toMatchObject({ attemptsLeft: 2 });

      codes.verify.mockRejectedValueOnce(new ConflictException());
      const spent = await caught(service.verifyEmail('a@example.com', '1'));
      expect(spent).toBeInstanceOf(ConflictException);
      expect(users[0].emailVerifiedAt).toBeNull();
    });

    it('answers an unknown or already verified email like a wrong code', async () => {
      await addUser('done@example.com', true);
      for (const email of ['nobody@example.com', 'done@example.com']) {
        const error = await caught(service.verifyEmail(email, '123456'));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ attemptsLeft: 4 });
      }
      expect(codes.verify).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('mails a new code to an unverified account', async () => {
      const user = await addUser('a@example.com', false);
      await service.resendVerification('a@example.com');
      expect(codes.issue).toHaveBeenCalledWith(
        expect.objectContaining({ id: user.id, email: user.email }),
        EmailCodePurpose.VERIFY_EMAIL,
      );
    });

    it('does nothing for an unknown or verified email', async () => {
      await addUser('done@example.com', true);
      await service.resendVerification('nobody@example.com');
      await service.resendVerification('done@example.com');
      expect(codes.issue).not.toHaveBeenCalled();
    });

    it('passes on the request limit', async () => {
      await addUser('a@example.com', false);
      codes.issue.mockRejectedValueOnce(tooMany());
      const error = await caught(service.resendVerification('a@example.com'));
      expect(error.getStatus()).toBe(429);
      expect(error.getResponse()).toMatchObject({ retryAfterSeconds: 30 });
    });

    it('stays quiet when the account vanished meanwhile', async () => {
      await addUser('a@example.com', false);
      codes.issue.mockRejectedValueOnce(new NotFoundException());
      await service.resendVerification('a@example.com');
    });
  });

  describe('login', () => {
    it('signs in a verified account', async () => {
      const user = await addUser('a@example.com', true);
      const result = await service.login({
        email: 'a@example.com',
        password: 'password123',
      });
      expect(result).toEqual({
        access_token: `jwt-${user.id}`,
        refresh_token: `refresh-${user.id}`,
      });
      expect(sessions.start).toHaveBeenCalledWith(
        expect.objectContaining({ id: user.id, tokenVersion: 3 }),
      );
      expect(codes.issue).not.toHaveBeenCalled();
    });

    it('answers an unverified account with 403 EMAIL_NOT_VERIFIED and a new code', async () => {
      const user = await addUser('a@example.com', false);
      const error = await caught(
        service.login({ email: 'a@example.com', password: 'password123' }),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(codes.issue).toHaveBeenCalledWith(
        expect.objectContaining({ id: user.id }),
        EmailCodePurpose.VERIFY_EMAIL,
      );
    });

    it('still answers 403 when no code could be sent', async () => {
      await addUser('a@example.com', false);
      for (const failure of [tooMany(), new ServiceUnavailableException()]) {
        codes.issue.mockRejectedValueOnce(failure);
        const error = await caught(
          service.login({ email: 'a@example.com', password: 'password123' }),
        );
        expect(error.getStatus()).toBe(403);
        expect(error.getResponse()).toMatchObject({
          code: 'EMAIL_NOT_VERIFIED',
        });
      }
    });

    it('answers a wrong password with 401, verified or not, without a code', async () => {
      await addUser('a@example.com', false);
      const error = await caught(
        service.login({ email: 'a@example.com', password: 'wrong-pass' }),
      );
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(codes.issue).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('mails a reset code to a verified account', async () => {
      const user = await addUser('a@example.com', true);
      await service.forgotPassword('a@example.com');
      expect(codes.issue).toHaveBeenCalledWith(
        expect.objectContaining({ id: user.id, email: user.email }),
        EmailCodePurpose.RESET_PASSWORD,
      );
    });

    it('does nothing for an unknown or unverified email', async () => {
      await addUser('new@example.com', false);
      await service.forgotPassword('nobody@example.com');
      await service.forgotPassword('new@example.com');
      expect(codes.issue).not.toHaveBeenCalled();
    });

    it('answers the same when no code is sent (limit, mail down, account gone)', async () => {
      await addUser('a@example.com', true);
      for (const failure of [
        tooMany(),
        new ServiceUnavailableException(),
        new NotFoundException(),
      ]) {
        codes.issue.mockRejectedValueOnce(failure);
        await expect(
          service.forgotPassword('a@example.com'),
        ).resolves.toBeUndefined();
      }
    });

    it('passes on errors that are not HTTP answers', async () => {
      await addUser('a@example.com', true);
      codes.issue.mockRejectedValueOnce(new Error('db down'));
      await expect(service.forgotPassword('a@example.com')).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('resetPassword', () => {
    const lockedFields = {
      failedPasswordAttempts: 2,
      passwordLockedUntil: new Date(Date.now() + 60_000),
    };

    it('sets the new password, raises tokenVersion and clears the lock on the right code', async () => {
      const user = await addUser('a@example.com', true);
      Object.assign(user, lockedFields);
      await service.resetPassword('a@example.com', '123456', 'new-secret');
      expect(codes.verify).toHaveBeenCalledWith(
        user.id,
        EmailCodePurpose.RESET_PASSWORD,
        '123456',
      );
      const saved = users[0];
      expect(await bcrypt.compare('new-secret', saved.passwordHash!)).toBe(
        true,
      );
      expect(await bcrypt.compare('password123', saved.passwordHash!)).toBe(
        false,
      );
      expect(saved).toMatchObject({
        tokenVersion: 4,
        failedPasswordAttempts: 0,
        passwordLockedUntil: null,
      });
      expect(saved.emailVerifiedAt).toEqual(new Date('2026-01-01'));
    });

    it('raises tokenVersion from a locked re-read of the account', async () => {
      const user = await addUser('a@example.com', true);
      // Another password change lands while the code is being checked
      codes.verify.mockImplementationOnce(() => {
        users = users.map((u) =>
          u.id === user.id ? { ...u, tokenVersion: 7 } : u,
        );
        return Promise.resolve();
      });
      await service.resetPassword('a@example.com', '123456', 'new-secret');
      expect(users[0].tokenVersion).toBe(8);
      const tx = repo.manager as unknown as { transaction: jest.Mock };
      expect(tx.transaction).toHaveBeenCalledTimes(1);
    });

    it('marks an unverified email verified', async () => {
      await addUser('a@example.com', false);
      await service.resetPassword('a@example.com', '123456', 'new-secret');
      expect(users[0].emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('passes on a wrong or spent code and changes nothing', async () => {
      const user = await addUser('a@example.com', true);
      const before = { ...user };
      codes.verify.mockRejectedValueOnce(
        new BadRequestException({ attemptsLeft: 2 }),
      );
      const wrong = await caught(
        service.resetPassword('a@example.com', '1', 'new-secret'),
      );
      expect(wrong.getResponse()).toMatchObject({ attemptsLeft: 2 });

      codes.verify.mockRejectedValueOnce(new ConflictException());
      const spent = await caught(
        service.resetPassword('a@example.com', '1', 'new-secret'),
      );
      expect(spent).toBeInstanceOf(ConflictException);
      expect(users[0]).toEqual(before);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('answers an unknown email like a wrong code', async () => {
      const error = await caught(
        service.resetPassword('nobody@example.com', '123456', 'new-secret'),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ attemptsLeft: 4 });
      expect(codes.verify).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('signs an access token for the user of the rotated session', async () => {
      const user = await addUser('a@example.com', true);
      sessions.refresh.mockResolvedValueOnce({ user, refreshToken: 'next' });
      expect(await service.refresh('presented')).toEqual({
        access_token: `jwt-${user.id}`,
        refresh_token: 'next',
      });
      expect(sessions.refresh).toHaveBeenCalledWith('presented');
    });

    it('passes on a 401 for an ended session', async () => {
      sessions.refresh.mockRejectedValueOnce(new UnauthorizedException());
      const error = await caught(service.refresh('presented'));
      expect(error).toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the session of the token', async () => {
      await service.logout('presented');
      expect(sessions.revoke).toHaveBeenCalledWith('presented');
    });
  });
});
