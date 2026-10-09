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
});
