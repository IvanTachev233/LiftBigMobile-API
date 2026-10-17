import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/auth/user.entity';
import { InMemoryMailTransport } from '../src/mail/in-memory-mail.transport';
import { MailService } from '../src/mail/mail.service';
import { E2E_DATABASE, e2eDataSourceOptions } from './e2e-database';

// Boots the full AppModule on the e2e database, with the same global pipe
// as main.ts. The schema is rebuilt from scratch unless dropSchema is false.
// Mails are kept in memory; read them with sentMails(app).
export async function createE2eApp({
  dropSchema = true,
}: { dropSchema?: boolean } = {}): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DataSource)
    .useFactory({
      factory: async () => {
        const options = { ...e2eDataSourceOptions(), dropSchema };
        if (options.database !== E2E_DATABASE) {
          throw new Error(`e2e must not run against ${options.database}`);
        }
        return new DataSource(options).initialize();
      },
    })
    .overrideProvider(MailService)
    .useValue(new InMemoryMailTransport())
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // Listening on 127.0.0.1 ourselves: supertest would otherwise listen on
  // every interface and then call 127.0.0.1, where another local process
  // can hold the same port.
  await app.listen(0, '127.0.0.1');
  return app;
}

// Every mail the app sent, oldest first
export function sentMails(app: INestApplication<App>): InMemoryMailTransport {
  return app.get(MailService);
}

export interface E2eUser {
  id: string;
  email: string;
  password: string;
  token: string;
}

// The 6-digit code in the newest mail sent to this address
export function mailedCode(app: INestApplication<App>, email: string): string {
  const mail = sentMails(app).lastTo(email);
  const match = mail && /\b(\d{6})\b/.exec(mail.text);
  if (!match) throw new Error(`No code mailed to ${email}`);
  return match[1];
}

// The user id (sub) inside an access token
export function tokenUserId(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ) as { sub: string };
  return payload.sub;
}

// Registers a user with a unique email, confirms it with the mailed code,
// logs in and returns the login token.
export async function registerAndLogin(
  app: INestApplication<App>,
  role: 'CLIENT' | 'COACH' = 'CLIENT',
): Promise<E2eUser> {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = 'password123';
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ name: 'E2E User', email, password, role })
    .expect(201);
  await request(app.getHttpServer())
    .post('/auth/verify-email')
    .send({ email, code: mailedCode(app, email) })
    .expect(200);
  const loggedIn = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(201);

  const { access_token: token } = loggedIn.body as { access_token: string };
  return { id: tokenUserId(token), email, password, token };
}

// A verified account stored directly, like one that existed before email
// confirmation (backfilled emailVerifiedAt); no code was mailed. Logs in.
export async function createExistingUser(
  app: INestApplication<App>,
  role: 'CLIENT' | 'COACH' = 'CLIENT',
): Promise<E2eUser> {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = 'password123';
  await app
    .get(DataSource)
    .getRepository(User)
    .insert({
      name: 'E2E User',
      email,
      passwordHash: await bcrypt.hash(password, 4),
      role,
      emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    });
  const loggedIn = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(201);

  const { access_token: token } = loggedIn.body as { access_token: string };
  return { id: tokenUserId(token), email, password, token };
}
