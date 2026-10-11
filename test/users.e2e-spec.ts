import { INestApplication } from '@nestjs/common';
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
});
