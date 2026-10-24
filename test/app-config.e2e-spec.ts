import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createE2eApp } from './e2e-app';

// The version check the app makes at start and on resume
describe('App config (e2e)', () => {
  let app: INestApplication<App>;
  const saved = {
    min: process.env.APP_MIN_VERSION_CODE,
    latest: process.env.APP_LATEST_VERSION_CODE,
  };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeAll(async () => {
    delete process.env.APP_MIN_VERSION_CODE;
    delete process.env.APP_LATEST_VERSION_CODE;
    app = await createE2eApp();
  });

  afterEach(() => {
    delete process.env.APP_MIN_VERSION_CODE;
    delete process.env.APP_LATEST_VERSION_CODE;
  });

  afterAll(async () => {
    await app.close();
    restore('APP_MIN_VERSION_CODE', saved.min);
    restore('APP_LATEST_VERSION_CODE', saved.latest);
  });

  it('has no minimum and no latest without env, and needs no auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/app-config')
      .expect(200);

    expect(res.body).toEqual({ minVersionCode: null, latestVersionCode: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns the version codes from env', async () => {
    process.env.APP_MIN_VERSION_CODE = '3';
    process.env.APP_LATEST_VERSION_CODE = '5';

    const res = await request(app.getHttpServer())
      .get('/app-config')
      .expect(200);

    expect(res.body).toEqual({ minVersionCode: 3, latestVersionCode: 5 });
  });

  it('reads each value on its own', async () => {
    process.env.APP_LATEST_VERSION_CODE = '4';

    const res = await request(app.getHttpServer())
      .get('/app-config')
      .expect(200);

    expect(res.body).toEqual({ minVersionCode: null, latestVersionCode: 4 });
  });
});
