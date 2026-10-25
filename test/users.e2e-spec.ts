import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

describe('Users me (e2e)', () => {
  let app: INestApplication<App>;
  let client: E2eUser;

  const me = (user: E2eUser) => ({
    get: () =>
      request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${user.token}`),
    patch: (body: object) =>
      request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .send(body),
  });

  beforeAll(async () => {
    app = await createE2eApp();
  });

  beforeEach(async () => {
    client = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('needs a login', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
    await request(app.getHttpServer())
      .patch('/users/me')
      .send({ weightUnit: 'lb' })
      .expect(401);
  });

  it('returns the profile in kg by default, without the password hash', async () => {
    const body = (await me(client).get().expect(200)).body as object;
    expect(body).toEqual({
      id: client.id,
      email: client.email,
      name: 'E2E User',
      role: 'CLIENT',
      weightUnit: 'kg',
      restSeconds: 120,
      needsAcceptance: [],
      consents: {
        health_data: true,
        video_training: false,
        product_emails: false,
      },
      consentsUpdatedAt: {
        health_data: expect.any(String) as string,
        video_training: null,
        product_emails: null,
      },
    });
  });

  it('defaults a row written without a unit to kg', async () => {
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `INSERT INTO "user" ("email", "passwordHash") VALUES ($1, 'x')`,
      [`legacy-${client.id}@example.com`],
    );
    const [row] = await dataSource.query<{ weightUnit: string }[]>(
      `SELECT "weightUnit" FROM "user" WHERE "email" = $1`,
      [`legacy-${client.id}@example.com`],
    );
    expect(row.weightUnit).toBe('kg');
  });

  it('defaults a row written without a rest time to 120 seconds', async () => {
    const dataSource = app.get(DataSource);
    const [row] = await dataSource.query<{ restSeconds: number }[]>(
      `INSERT INTO "user" ("email", "passwordHash") VALUES ($1, 'x')
       RETURNING "restSeconds"`,
      [`legacy-rest-${client.id}@example.com`],
    );
    expect(row.restSeconds).toBe(120);
  });

  it('changes the unit of the caller only', async () => {
    const other = await registerAndLogin(app);
    const body = (
      await me(client)
        .patch({ weightUnit: 'lb', role: 'COACH', email: 'x@example.com' })
        .expect(200)
    ).body as object;
    expect(body).toMatchObject({
      weightUnit: 'lb',
      role: 'CLIENT',
      email: client.email,
    });
    expect((await me(client).get().expect(200)).body).toMatchObject({
      weightUnit: 'lb',
    });
    expect((await me(other).get().expect(200)).body).toMatchObject({
      weightUnit: 'kg',
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('rejects an invalid unit', async () => {
    await me(client).patch({ weightUnit: 'stone' }).expect(400);
    await me(client).patch({}).expect(400);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      weightUnit: 'kg',
    });
  });

  it('changes the rest time of the caller only, keeping the unit', async () => {
    const other = await registerAndLogin(app);
    const body = (await me(client).patch({ restSeconds: 90 }).expect(200))
      .body as object;
    expect(body).toMatchObject({ restSeconds: 90, weightUnit: 'kg' });
    expect((await me(client).get().expect(200)).body).toMatchObject({
      restSeconds: 90,
    });
    expect((await me(other).get().expect(200)).body).toMatchObject({
      restSeconds: 120,
    });
  });

  it('changes the unit and the rest time together', async () => {
    await me(client).patch({ weightUnit: 'lb', restSeconds: 45 }).expect(200);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      weightUnit: 'lb',
      restSeconds: 45,
    });
  });

  it('keeps the rest time when only the unit changes', async () => {
    await me(client).patch({ restSeconds: 150 }).expect(200);
    await me(client).patch({ weightUnit: 'lb' }).expect(200);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      weightUnit: 'lb',
      restSeconds: 150,
    });
  });

  it('accepts a rest time from 0 to 600 seconds', async () => {
    await me(client).patch({ restSeconds: 0 }).expect(200);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      restSeconds: 0,
    });
    await me(client).patch({ restSeconds: 600 }).expect(200);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      restSeconds: 600,
    });
  });

  it('rejects a rest time outside 0-600 whole seconds', async () => {
    for (const restSeconds of [-1, 601, 90.5, '120', null, true]) {
      await me(client).patch({ restSeconds }).expect(400);
    }
    await me(client).patch({ weightUnit: 'lb', restSeconds: 601 }).expect(400);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      weightUnit: 'kg',
      restSeconds: 120,
    });
  });

  it('rejects a body with only unknown fields', async () => {
    await me(client).patch({ role: 'COACH' }).expect(400);
  });

  it('changes the name of the caller only, trimmed, keeping the settings', async () => {
    const other = await registerAndLogin(app);
    await me(client).patch({ weightUnit: 'lb', restSeconds: 90 }).expect(200);
    const body = (await me(client).patch({ name: '  Una Lifter ' }).expect(200))
      .body as object;
    expect(body).toMatchObject({
      name: 'Una Lifter',
      weightUnit: 'lb',
      restSeconds: 90,
    });
    expect((await me(client).get().expect(200)).body).toMatchObject({
      name: 'Una Lifter',
    });
    expect((await me(other).get().expect(200)).body).toMatchObject({
      name: 'E2E User',
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('changes the name with the other settings', async () => {
    await me(client)
      .patch({ name: 'Both', weightUnit: 'lb', restSeconds: 0 })
      .expect(200);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      name: 'Both',
      weightUnit: 'lb',
      restSeconds: 0,
    });
  });

  it('rejects a blank, missing-value or too long name', async () => {
    for (const name of ['', '   ', null, 42, 'x'.repeat(101)]) {
      await me(client).patch({ name }).expect(400);
    }
    await me(client).patch({ name: 'Ok', restSeconds: 601 }).expect(400);
    expect((await me(client).get().expect(200)).body).toMatchObject({
      name: 'E2E User',
      restSeconds: 120,
    });
    await me(client)
      .patch({ name: 'x'.repeat(100) })
      .expect(200);
  });
});

describe('Users me password (e2e)', () => {
  let app: INestApplication<App>;
  let client: E2eUser;

  const changePassword = (user: E2eUser, body: object) =>
    request(app.getHttpServer())
      .post('/users/me/password')
      .set('Authorization', `Bearer ${user.token}`)
      .send(body);
  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  beforeAll(async () => {
    app = await createE2eApp();
  });

  beforeEach(async () => {
    client = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('needs a login', async () => {
    await request(app.getHttpServer())
      .post('/users/me/password')
      .send({ currentPassword: 'password123', newPassword: 'another1' })
      .expect(401);
  });

  const getMe = (token: string) =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`);
  const right = () => ({
    currentPassword: client.password,
    newPassword: 'new-secret',
  });
  const wrong = () => ({
    currentPassword: 'wrong-password',
    newPassword: 'new-secret',
  });

  it('changes the password with the right current one and returns only new tokens', async () => {
    const res = await changePassword(client, right()).expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'access_token',
      'refresh_token',
    ]);
    expect(res.text).not.toContain('$2');
    await login(client.email, 'new-secret').expect(201);
    await login(client.email, client.password).expect(401);
  });

  it('revokes every earlier token; the returned one and new logins work', async () => {
    const otherDevice = (
      (await login(client.email, client.password).expect(201)).body as {
        access_token: string;
      }
    ).access_token;
    const res = await changePassword(client, right()).expect(200);
    const fresh = (res.body as { access_token: string }).access_token;

    await getMe(client.token).expect(401);
    await getMe(otherDevice).expect(401);
    await request(app.getHttpServer())
      .get('/workouts')
      .set('Authorization', `Bearer ${client.token}`)
      .expect(401);
    await getMe(fresh).expect(200);
    const relogin = (
      (await login(client.email, 'new-secret').expect(201)).body as {
        access_token: string;
      }
    ).access_token;
    await getMe(relogin).expect(200);
  });

  it('accepts a token signed before token versions existed until the next change', async () => {
    const legacy = app
      .get(JwtService)
      .sign({ sub: client.id, email: client.email, role: 'CLIENT' });
    await getMe(legacy).expect(200);
    await changePassword(client, right()).expect(200);
    await getMe(legacy).expect(401);
  });

  it('refuses a wrong current password with 403, saying how many tries are left', async () => {
    const first = await changePassword(client, wrong()).expect(403);
    expect(first.body).toMatchObject({ attemptsLeft: 2 });
    expect(first.text).not.toContain('passwordHash');
    expect(first.text).not.toContain('$2');
    const second = await changePassword(client, wrong()).expect(403);
    expect(second.body).toMatchObject({ attemptsLeft: 1 });
    await login(client.email, client.password).expect(201);
    await login(client.email, 'new-secret').expect(401);
  });

  it('locks the change for 15 minutes on the third wrong password, even for the right one', async () => {
    await changePassword(client, wrong()).expect(403);
    await changePassword(client, wrong()).expect(403);
    const locked = await changePassword(client, wrong()).expect(429);
    expect(locked.body).toMatchObject({ retryAfterMinutes: 15 });
    const still = await changePassword(client, right()).expect(429);
    expect(
      (still.body as { retryAfterMinutes: number }).retryAfterMinutes,
    ).toBeGreaterThan(0);
    await login(client.email, client.password).expect(201);
    await getMe(client.token).expect(200);
  });

  it('opens again once the lock has run out, with a fresh count', async () => {
    for (let i = 0; i < 3; i++) await changePassword(client, wrong());
    await app
      .get(DataSource)
      .query(
        `UPDATE "user" SET "passwordLockedUntil" = now() - interval '1 second' WHERE "id" = $1`,
        [client.id],
      );
    const res = await changePassword(client, wrong()).expect(403);
    expect(res.body).toMatchObject({ attemptsLeft: 2 });
    await changePassword(client, right()).expect(200);
  });

  it('resets the count after a successful change', async () => {
    await changePassword(client, wrong()).expect(403);
    await changePassword(client, wrong()).expect(403);
    const res = await changePassword(client, right()).expect(200);
    client.token = (res.body as { access_token: string }).access_token;
    client.password = 'new-secret';
    const next = await changePassword(client, {
      currentPassword: 'wrong-password',
      newPassword: 'third-secret',
    }).expect(403);
    expect(next.body).toMatchObject({ attemptsLeft: 2 });
  });

  it('does not count a rejected body as an attempt', async () => {
    for (let i = 0; i < 3; i++) {
      await changePassword(client, {
        currentPassword: 'wrong-password',
        newPassword: 'abc',
      }).expect(400);
    }
    const res = await changePassword(client, wrong()).expect(403);
    expect(res.body).toMatchObject({ attemptsLeft: 2 });
  });

  it('refuses a new password under 6 characters with 400', async () => {
    await changePassword(client, {
      currentPassword: client.password,
      newPassword: 'abc12',
    }).expect(400);
    await login(client.email, client.password).expect(201);
  });

  it('checks the body before the current password', async () => {
    await changePassword(client, {
      currentPassword: 'wrong-password',
      newPassword: 'abc',
    }).expect(400);
  });

  it('rejects missing or non-string fields', async () => {
    for (const body of [
      {},
      { currentPassword: client.password },
      { newPassword: 'new-secret' },
      { currentPassword: '', newPassword: 'new-secret' },
      { currentPassword: client.password, newPassword: 123456 },
      { currentPassword: client.password, newPassword: null },
    ]) {
      await changePassword(client, body).expect(400);
    }
    await login(client.email, client.password).expect(201);
  });

  it("changes only the caller's password", async () => {
    const other = await registerAndLogin(app);
    await changePassword(client, {
      currentPassword: client.password,
      newPassword: 'new-secret',
    }).expect(200);
    await login(other.email, other.password).expect(201);
    await getMe(other.token).expect(200);
  });
});
