import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { E2E_DATABASE, e2eDataSourceOptions } from './e2e-database';

// Boots the full AppModule against an empty e2e database, with the same
// global pipe as main.ts.
export async function createE2eApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DataSource)
    .useFactory({
      factory: async () => {
        const options = e2eDataSourceOptions();
        if (options.database !== E2E_DATABASE) {
          throw new Error(`e2e must not run against ${options.database}`);
        }
        return new DataSource(options).initialize();
      },
    })
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  return app;
}

export interface E2eUser {
  id: string;
  email: string;
  password: string;
  token: string;
}

// Registers a user with a unique email, logs in and returns the token.
export async function registerAndLogin(
  app: INestApplication<App>,
  role: 'CLIENT' | 'COACH' = 'CLIENT',
): Promise<E2eUser> {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = 'password123';
  const registered = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ name: 'E2E User', email, password, role })
    .expect(201);
  const loggedIn = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(201);

  const body = registered.body as { user: { id: string } };
  const login = loggedIn.body as { access_token: string };
  return { id: body.user.id, email, password, token: login.access_token };
}
