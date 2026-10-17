import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuthSession } from '../src/auth/auth-session.entity';
import { User } from '../src/auth/user.entity';
import {
  E2eUser,
  createE2eApp,
  createExistingUser,
  mailedCode,
  registerAndLogin,
} from './e2e-app';

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Refresh-token sessions through HTTP. Time moves with a Date.now offset:
// the session service and JWT signing/verification both read Date.now.
describe('Auth sessions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let user: E2eUser;
  let offset = 0;
  // The real time, read without Date.now so the spy can't loop back to it
  const realNow = () => Math.floor(performance.timeOrigin + performance.now());
  const advance = (ms: number) => {
    offset += ms;
  };

  const server = () => app.getHttpServer();
  const refresh = (refresh_token: string) =>
    request(server()).post('/auth/refresh').send({ refresh_token });
  const logout = (refresh_token: string) =>
    request(server()).post('/auth/logout').send({ refresh_token });
  const login = (email: string, password: string) =>
    request(server()).post('/auth/login').send({ email, password });
  const getMe = (token: string) =>
    request(server()).get('/users/me').set('Authorization', `Bearer ${token}`);
  const pairOf = (res: request.Response) => res.body as TokenPair;
  // The refresh token of a successful refresh
  const rotate = async (token: string) =>
    pairOf(await refresh(token).expect(200)).refresh_token;
  const sessionsOf = (userId: string) =>
    dataSource.getRepository(AuthSession).findBy({ userId });
  const claimsOf = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      sub: string;
      name: string | null;
      coachId: string | null;
      ver: number;
      exp: number;
      iat: number;
    };

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    offset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    // Signed in once, so the user has exactly one session
    user = await createExistingUser(app);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const expectPair = async (body: unknown) => {
    const pair = body as TokenPair;
    expect(Object.keys(pair).sort()).toEqual(['access_token', 'refresh_token']);
    expect(pair.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await getMe(pair.access_token).expect(200);
    await refresh(pair.refresh_token).expect(200);
  };

  describe('signing in', () => {
    it('login returns an access token and a refresh token', async () => {
      await expectPair((await login(user.email, user.password)).body);
    });

    it('verify-email returns a pair', async () => {
      const email = `e2e-${randomUUID()}@example.com`;
      await request(server())
        .post('/auth/register')
        .send({ name: 'New Lifter', email, password: 'password123' })
        .expect(201);
      const res = await request(server())
        .post('/auth/verify-email')
        .send({ email, code: mailedCode(app, email) })
        .expect(200);
      await expectPair(res.body);
    });

    it('change password returns a pair for this device', async () => {
      const res = await request(server())
        .post('/users/me/password')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ currentPassword: user.password, newPassword: 'new-secret' })
        .expect(200);
      await expectPair(res.body);
    });

    it('signs access tokens for 15 minutes', async () => {
      const { access_token } = pairOf(await login(user.email, user.password));
      const { iat, exp } = claimsOf(access_token);
      expect(exp - iat).toBe(15 * 60);
    });

    it('stores only the hash of the refresh token', async () => {
      const [session] = await sessionsOf(user.id);
      expect(session.tokenHash).toBe(
        createHash('sha256').update(user.refreshToken).digest('hex'),
      );
      const rows: unknown[] = await dataSource.query(
        'SELECT * FROM "auth_session" WHERE "userId" = $1',
        [user.id],
      );
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(user.refreshToken);

      const next = await rotate(user.refreshToken);
      expect(JSON.stringify(await sessionsOf(user.id))).not.toContain(next);
    });

    it('deletes the user’s revoked and expired sessions', async () => {
      const revoked = pairOf(await login(user.email, user.password));
      await logout(revoked.refresh_token).expect(204);
      await login(user.email, user.password).expect(201);
      // The first session and the new one; the revoked one went
      expect(await sessionsOf(user.id)).toHaveLength(2);

      advance(31 * DAY);
      const fresh = pairOf(await login(user.email, user.password));
      const sessions = await sessionsOf(user.id);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].tokenHash).toBe(
        createHash('sha256').update(fresh.refresh_token).digest('hex'),
      );
    });
  });

  describe('refresh', () => {
    it('returns a new pair; the old token is reuse after 60 s', async () => {
      const res = await refresh(user.refreshToken).expect(200);
      const pair = pairOf(res);
      expect(pair.refresh_token).not.toBe(user.refreshToken);
      await getMe(pair.access_token).expect(200);

      advance(61_000);
      await refresh(user.refreshToken).expect(401);
    });

    it('rotates the previous token again within 60 s (lost response)', async () => {
      await rotate(user.refreshToken);
      advance(30_000);
      const retried = await rotate(user.refreshToken);
      await rotate(retried);
    });

    it('counts the 60 s from the first rotation, not from a retry', async () => {
      await rotate(user.refreshToken);
      advance(30_000);
      await rotate(user.refreshToken);
      advance(31_000);
      await refresh(user.refreshToken).expect(401);
    });

    it('answers two concurrent refreshes with one token', async () => {
      const results = await Promise.all([
        refresh(user.refreshToken),
        refresh(user.refreshToken),
      ]);
      expect(results.map((res) => res.status)).toEqual([200, 200]);
    });

    it('revokes the session when the previous token comes back after 60 s', async () => {
      const current = await rotate(user.refreshToken);
      advance(61_000);
      await refresh(user.refreshToken).expect(401);
      await refresh(current).expect(401);
      const [session] = await sessionsOf(user.id);
      expect(session.revokedAt).toBeInstanceOf(Date);
    });

    it('rejects a token older than the previous one', async () => {
      const second = await rotate(user.refreshToken);
      advance(61_000);
      await rotate(second);
      await refresh(user.refreshToken).expect(401);
    });

    it('rejects an unknown token', async () => {
      await refresh(Buffer.alloc(32).toString('base64url')).expect(401);
    });

    it('ends a session unused for 30 days', async () => {
      advance(29 * DAY);
      const token = await rotate(user.refreshToken);
      advance(29 * DAY);
      const next = await rotate(token);
      advance(30 * DAY + 1000);
      await refresh(next).expect(401);
    });

    it('ends a session 90 days after sign-in however often it is used', async () => {
      let token = user.refreshToken;
      for (let i = 0; i < 3; i++) {
        advance(29 * DAY);
        token = await rotate(token);
      }
      advance(3 * DAY);
      await refresh(token).expect(401);
    });

    it('signs the new access token from the current user row', async () => {
      const coach = await registerAndLogin(app, 'COACH');
      await dataSource
        .getRepository(User)
        .update(user.id, { name: 'Renamed', coachId: coach.id });

      const { access_token } = pairOf(
        await refresh(user.refreshToken).expect(200),
      );
      expect(claimsOf(access_token)).toMatchObject({
        sub: user.id,
        name: 'Renamed',
        coachId: coach.id,
      });
    });

    it('needs a refresh token in the body', async () => {
      await request(server()).post('/auth/refresh').send({}).expect(400);
    });
  });

  describe('ending other sessions', () => {
    it('change password ends every other session', async () => {
      const other = pairOf(await login(user.email, user.password));
      const res = await request(server())
        .post('/users/me/password')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ currentPassword: user.password, newPassword: 'new-secret' })
        .expect(200);

      await refresh(user.refreshToken).expect(401);
      await refresh(other.refresh_token).expect(401);
      await refresh(pairOf(res).refresh_token).expect(200);
    });

    it('password reset ends every session', async () => {
      await request(server())
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(204);
      await request(server())
        .post('/auth/reset-password')
        .send({
          email: user.email,
          code: mailedCode(app, user.email),
          newPassword: 'brand-new-secret',
        })
        .expect(204);
      await refresh(user.refreshToken).expect(401);
    });

    it('deleting a client account ends its sessions', async () => {
      await request(server())
        .delete('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password })
        .expect(204);
      await refresh(user.refreshToken).expect(401);
      expect(await sessionsOf(user.id)).toHaveLength(0);
    });

    it('deleting a coach account ends its sessions', async () => {
      const coach = await registerAndLogin(app, 'COACH');
      await request(server())
        .delete('/users/me')
        .set('Authorization', `Bearer ${coach.token}`)
        .send({ password: coach.password })
        .expect(204);
      await refresh(coach.refreshToken).expect(401);
      expect(await sessionsOf(coach.id)).toHaveLength(0);
    });
  });

  describe('logout', () => {
    it('answers 204 and ends the session', async () => {
      const res = await logout(user.refreshToken).expect(204);
      expect(res.text).toBe('');
      await refresh(user.refreshToken).expect(401);
      await logout(user.refreshToken).expect(204);
    });

    it('answers 204 for an unknown token', async () => {
      await logout(Buffer.alloc(32).toString('base64url')).expect(204);
    });

    it('leaves the user’s other sessions alone', async () => {
      const other = pairOf(await login(user.email, user.password));
      await logout(user.refreshToken).expect(204);
      await refresh(other.refresh_token).expect(200);
    });

    it('needs a refresh token in the body', async () => {
      await request(server()).post('/auth/logout').send({}).expect(400);
    });
  });
});
