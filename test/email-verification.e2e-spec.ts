import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import {
  createE2eApp,
  createExistingUser,
  mailedCode,
  sentMails,
  SIGN_UP_AGREEMENT,
} from './e2e-app';

// Sign-up confirmation through HTTP: register, verify-email,
// resend-verification and login for unverified accounts.
describe('Email verification (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const password = 'password123';
  const server = () => app.getHttpServer();
  const register = (email: string) =>
    request(server())
      .post('/auth/register')
      .send({ name: 'New Lifter', email, password, ...SIGN_UP_AGREEMENT });
  const verify = (email: string, code: string) =>
    request(server()).post('/auth/verify-email').send({ email, code });
  const resend = (email: string) =>
    request(server()).post('/auth/resend-verification').send({ email });
  const login = (email: string, pass = password) =>
    request(server()).post('/auth/login').send({ email, password: pass });
  const mailsTo = (email: string) =>
    sentMails(app).sent.filter((mail) => mail.to === email).length;
  const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');
  const verifiedAt = async (email: string) =>
    (await dataSource.getRepository(User).findOneByOrFail({ email }))
      .emailVerifiedAt;
  // Moves the user's codes back past the 60 s cooldown
  const ageCodes = (email: string) =>
    dataSource.query(
      `UPDATE "email_code" SET "createdAt" = "createdAt" - interval '61 seconds'
       WHERE "userId" = (SELECT "id" FROM "user" WHERE "email" = $1)`,
      [email],
    );

  let email: string;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(() => {
    email = `e2e-verify-${randomUUID()}@example.com`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('register', () => {
    it('creates the account unverified, mails a code and returns no token', async () => {
      const res = await register(email).expect(201);
      expect(res.body).toEqual({ verificationRequired: true, email });
      expect(mailsTo(email)).toBe(1);
      expect(mailedCode(app, email)).toMatch(/^\d{6}$/);
      expect(await verifiedAt(email)).toBeNull();
    });

    it('still rejects a taken email with 409', async () => {
      await register(email).expect(201);
      await register(email).expect(409);
      expect(mailsTo(email)).toBe(1);
    });
  });

  describe('verify-email', () => {
    beforeEach(async () => {
      await register(email).expect(201);
    });

    it('signs in with the right code and marks the account verified', async () => {
      const res = await verify(email, mailedCode(app, email)).expect(200);
      const { access_token } = res.body as { access_token: string };
      expect(access_token).toEqual(expect.any(String));
      expect(await verifiedAt(email)).toBeInstanceOf(Date);

      const me = await request(server())
        .get('/users/me')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);
      expect((me.body as { email: string }).email).toBe(email);
      await login(email).expect(201);
    });

    it('answers a wrong code with 400 and attemptsLeft, and the 5th with 409', async () => {
      const code = mailedCode(app, email);
      for (const attemptsLeft of [4, 3, 2, 1]) {
        const res = await verify(email, wrongFor(code)).expect(400);
        expect(res.body).toMatchObject({ attemptsLeft });
      }
      await verify(email, wrongFor(code)).expect(409);
      // The spent code no longer works, even when right
      await verify(email, code).expect(409);
      expect(await verifiedAt(email)).toBeNull();
    });

    it('answers an unknown email like a wrong code', async () => {
      const res = await verify(
        `e2e-nobody-${randomUUID()}@example.com`,
        '123456',
      ).expect(400);
      expect(res.body).toMatchObject({ attemptsLeft: 4 });
    });

    it('rejects a body without an email or code', async () => {
      await request(server())
        .post('/auth/verify-email')
        .send({ email })
        .expect(400);
      await request(server())
        .post('/auth/verify-email')
        .send({ code: '123456' })
        .expect(400);
    });
  });

  describe('resend-verification', () => {
    it('answers 204 for an unknown email and sends nothing', async () => {
      await resend(email).expect(204);
      expect(mailsTo(email)).toBe(0);
    });

    it('answers 204 for a verified account and sends nothing', async () => {
      const existing = await createExistingUser(app);
      await resend(existing.email).expect(204);
      expect(mailsTo(existing.email)).toBe(0);
    });

    it('answers 429 with retryAfterSeconds inside the cooldown, then mails a new code', async () => {
      await register(email).expect(201);
      const first = mailedCode(app, email);
      const limited = await resend(email).expect(429);
      expect(
        (limited.body as { retryAfterSeconds: number }).retryAfterSeconds,
      ).toBeGreaterThan(0);
      expect(mailsTo(email)).toBe(1);

      await ageCodes(email);
      await resend(email).expect(204);
      expect(mailsTo(email)).toBe(2);
      const second = mailedCode(app, email);
      if (second !== first) await verify(email, first).expect(400);
      await verify(email, second).expect(200);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await register(email).expect(201);
    });

    it('answers an unverified account with 403 EMAIL_NOT_VERIFIED and a new code', async () => {
      await ageCodes(email);
      const res = await login(email).expect(403);
      expect(res.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(res.body).not.toHaveProperty('access_token');
      expect(mailsTo(email)).toBe(2);
      await verify(email, mailedCode(app, email)).expect(200);
      await login(email).expect(201);
    });

    it('still answers 403 (not 429) inside the cooldown, without a new mail', async () => {
      const res = await login(email).expect(403);
      expect(res.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(mailsTo(email)).toBe(1);
    });

    it('answers a wrong password with 401 and sends nothing', async () => {
      await ageCodes(email);
      const res = await login(email, 'wrong-password').expect(401);
      expect(res.body).not.toHaveProperty('code');
      expect(mailsTo(email)).toBe(1);
    });

    it('lets a pre-existing (backfilled) account log in as before', async () => {
      const existing = await createExistingUser(app);
      const res = await login(existing.email).expect(201);
      const body = res.body as { access_token: unknown };
      expect(Object.keys(body).sort()).toEqual([
        'access_token',
        'refresh_token',
      ]);
      expect(typeof body.access_token).toBe('string');
      expect(mailsTo(existing.email)).toBe(0);
      await login(existing.email, 'wrong-password').expect(401);
    });
  });
});
