import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createE2eApp, registerAndLogin } from './e2e-app';

describe('Workouts (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns no workouts for a newly registered user', async () => {
    const user = await registerAndLogin(app);

    await request(app.getHttpServer())
      .get('/workouts')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200)
      .expect([]);
  });
});
