import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import {
  E2eUser,
  createE2eApp,
  mailedCode,
  registerAndLogin,
  sentMails,
} from './e2e-app';

// Forgot password through HTTP: forgot-password mails a RESET_PASSWORD code
// to verified accounts only, reset-password sets the new password.
describe('Password reset (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let user: E2eUser;

  const newPassword = 'brand-new-secret';
  const server = () => app.getHttpServer();
  const forgot = (email: string) =>
    request(server()).post('/auth/forgot-password').send({ email });
  const reset = (email: string, code: string, password = newPassword) =>
    request(server())
      .post('/auth/reset-password')
      .send({ email, code, newPassword: password });
  const login = (email: string, password: string) =>
    request(server()).post('/auth/login').send({ email, password });
  const getMe = (token: string) =>
    request(server()).get('/users/me').set('Authorization', `Bearer ${token}`);
  const changePassword = (token: string, currentPassword: string) =>
    request(server())
      .post('/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword, newPassword: 'changed-secret' });
  const mailsTo = (email: string) =>
    sentMails(app).sent.filter((mail) => mail.to === email);
  const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');
  const row = (id: string) =>
    dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect([
        'user.tokenVersion',
        'user.failedPasswordAttempts',
        'user.passwordLockedUntil',
      ])
      .where('user.id = :id', { id })
      .getOneOrFail();
  // Moves the user's codes back past the 60 s cooldown
  const ageCodes = (email: string) =>
    dataSource.query(
      `UPDATE "email_code" SET "createdAt" = "createdAt" - interval '61 seconds'
       WHERE "userId" = (SELECT "id" FROM "user" WHERE "email" = $1)`,
      [email],
    );
  // A reset code for the user: forgot-password, then the mailed code
  const requestCode = async (email = user.email) => {
    await forgot(email).expect(204);
    return mailedCode(app, email);
  };

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    user = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('forgot-password', () => {
    it('answers 204 for an unknown email and sends nothing', async () => {
      const email = `e2e-nobody-${randomUUID()}@example.com`;
      const res = await forgot(email).expect(204);
      expect(res.text).toBe('');
      expect(mailsTo(email)).toHaveLength(0);
    });

    it('answers 204 for an unverified account and sends no reset code', async () => {
      const email = `e2e-unverified-${randomUUID()}@example.com`;
      await request(server())
        .post('/auth/register')
        .send({ name: 'New Lifter', email, password: 'password123' })
        .expect(201);
      await ageCodes(email);
      await forgot(email).expect(204);
      const mails = mailsTo(email);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toBe('Your LiftBig verification code');
    });

    it('mails a 6-digit reset code to a verified account', async () => {
      const res = await forgot(user.email).expect(204);
      expect(res.text).toBe('');
      const mail = sentMails(app).lastTo(user.email)!;
      expect(mail.subject).toBe('Your LiftBig password reset code');
      expect(mailedCode(app, user.email)).toMatch(/^\d{6}$/);
    });

    it('keeps answering 204 inside the cooldown without a second mail, then mails a new code', async () => {
      const first = await requestCode();
      const before = mailsTo(user.email).length;
      await forgot(user.email).expect(204);
      expect(mailsTo(user.email)).toHaveLength(before);

      await ageCodes(user.email);
      await forgot(user.email).expect(204);
      expect(mailsTo(user.email)).toHaveLength(before + 1);
      const second = mailedCode(app, user.email);
      // Only the newest code counts
      if (second !== first) await reset(user.email, first).expect(400);
      await reset(user.email, second).expect(204);
    });

    it('rejects a body without a valid email', async () => {
      await request(server())
        .post('/auth/forgot-password')
        .send({})
        .expect(400);
      await forgot('not-an-email').expect(400);
    });
  });

  describe('reset-password', () => {
    it('sets the new password and signs out every earlier token', async () => {
      const code = await requestCode();
      await getMe(user.token).expect(200);
      const before = await row(user.id);

      const res = await reset(user.email, code).expect(204);
      expect(res.text).toBe('');

      await login(user.email, user.password).expect(401);
      const fresh = await login(user.email, newPassword).expect(201);
      await getMe(user.token).expect(401);
      await getMe((fresh.body as { access_token: string }).access_token).expect(
        200,
      );
      expect((await row(user.id)).tokenVersion).toBe(before.tokenVersion + 1);
    });

    it('clears the Change password lock', async () => {
      for (let i = 0; i < 3; i++) await changePassword(user.token, 'wrong');
      await changePassword(user.token, user.password).expect(429);
      expect((await row(user.id)).passwordLockedUntil).toBeInstanceOf(Date);

      await reset(user.email, await requestCode()).expect(204);
      const after = await row(user.id);
      expect(after.passwordLockedUntil).toBeNull();
      expect(after.failedPasswordAttempts).toBe(0);

      const fresh = await login(user.email, newPassword).expect(201);
      const token = (fresh.body as { access_token: string }).access_token;
      await changePassword(token, newPassword).expect(200);
    });

    it('clears the Change password counter', async () => {
      await changePassword(user.token, 'wrong').expect(403);
      await changePassword(user.token, 'wrong').expect(403);
      expect((await row(user.id)).failedPasswordAttempts).toBe(2);

      await reset(user.email, await requestCode()).expect(204);
      expect((await row(user.id)).failedPasswordAttempts).toBe(0);

      const fresh = await login(user.email, newPassword).expect(201);
      const token = (fresh.body as { access_token: string }).access_token;
      const res = await changePassword(token, 'wrong').expect(403);
      expect(res.body).toMatchObject({ attemptsLeft: 2 });
    });

    it('marks the email verified', async () => {
      const code = await requestCode();
      // An account whose verification was cleared after the code went out
      await dataSource
        .getRepository(User)
        .update(user.id, { emailVerifiedAt: null });

      await reset(user.email, code).expect(204);
      const after = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(after.emailVerifiedAt).toBeInstanceOf(Date);
      await login(user.email, newPassword).expect(201);
    });

    it('answers a wrong code with 400 and attemptsLeft, and the 5th with 409', async () => {
      const code = await requestCode();
      for (const attemptsLeft of [4, 3, 2, 1]) {
        const res = await reset(user.email, wrongFor(code)).expect(400);
        expect(res.body).toMatchObject({ attemptsLeft });
      }
      await reset(user.email, wrongFor(code)).expect(409);
      // The spent code no longer works, even when right
      await reset(user.email, code).expect(409);
      await login(user.email, user.password).expect(201);
      await login(user.email, newPassword).expect(401);
    });

    it('answers a used code with 409', async () => {
      const code = await requestCode();
      await reset(user.email, code).expect(204);
      await reset(user.email, code, 'another-secret').expect(409);
      await login(user.email, newPassword).expect(201);
    });

    it('answers an unknown email like a wrong code', async () => {
      const res = await reset(
        `e2e-nobody-${randomUUID()}@example.com`,
        '123456',
      ).expect(400);
      expect(res.body).toMatchObject({ attemptsLeft: 4 });
    });

    it('rejects a new password under 6 characters before checking the code', async () => {
      const code = await requestCode();
      const short = await reset(user.email, wrongFor(code), '12345').expect(
        400,
      );
      expect(short.body).not.toHaveProperty('attemptsLeft');
      // The short-password request did not count as a wrong code
      const wrong = await reset(user.email, wrongFor(code)).expect(400);
      expect(wrong.body).toMatchObject({ attemptsLeft: 4 });
      await reset(user.email, code).expect(204);
    });

    it('rejects a body without a code or new password', async () => {
      await request(server())
        .post('/auth/reset-password')
        .send({ email: user.email, newPassword })
        .expect(400);
      await request(server())
        .post('/auth/reset-password')
        .send({ email: user.email, code: '123456' })
        .expect(400);
    });
  });
});
