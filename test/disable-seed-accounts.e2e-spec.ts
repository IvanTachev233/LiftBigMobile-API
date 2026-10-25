import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In, MigrationInterface } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { MockUser1709800000000 } from '../src/migrations/1709800000000-MockUser';
import { SeedCoachAndProgram1709800000003 } from '../src/migrations/1709800000003-SeedCoachAndProgram';
import { EmailVerifiedAt1709800000008 } from '../src/migrations/1709800000008-EmailVerifiedAt';
import { DisableSeedAccounts1709800000011 } from '../src/migrations/1709800000011-DisableSeedAccounts';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

const SEED_EMAILS = [
  'mockuser@liftbig.com',
  'mockuser_specific@liftbig.com',
  'coach@liftbig.com',
];

interface Session {
  email: string;
  token: string;
  refreshToken: string;
}

describe('Disabling the seed accounts (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let other: E2eUser;
  let seedSessions: Session[];
  // Stands in for the password the seed migrations published
  const knownPassword = randomUUID();

  const server = () => app.getHttpServer();
  const login = (email: string, password: string) =>
    request(server()).post('/auth/login').send({ email, password });
  const getMe = (token: string) =>
    request(server()).get('/users/me').set('Authorization', `Bearer ${token}`);
  const refresh = (refresh_token: string) =>
    request(server()).post('/auth/refresh').send({ refresh_token });
  const seedUser = (email: string) =>
    dataSource.getRepository(User).findOneOrFail({
      where: { email },
      select: { id: true, email: true, passwordHash: true, coachId: true },
    });

  async function migrate(...migrations: MigrationInterface[]) {
    const runner = dataSource.createQueryRunner();
    try {
      for (const migration of migrations) await migration.up(runner);
    } finally {
      await runner.release();
    }
  }

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    other = await registerAndLogin(app);

    // The seed accounts as production has them: seeded, then backfilled
    // as verified by 0008. 0002's workout inserts no longer fit the schema,
    // so its user row is inserted as 0002 does.
    await migrate(new MockUser1709800000000());
    await dataSource.query(
      `INSERT INTO "user" ("id", "email", "passwordHash", "role")
       VALUES ('313f2ec4-e9a4-4384-9fc1-09e734815f9f', 'mockuser_specific@liftbig.com', 'seeded', 'CLIENT')`,
    );
    await migrate(
      new SeedCoachAndProgram1709800000003(),
      new EmailVerifiedAt1709800000008(),
    );
    await dataSource
      .getRepository(User)
      .update(
        { email: In(SEED_EMAILS) },
        { passwordHash: await bcrypt.hash(knownPassword, 4) },
      );

    seedSessions = [];
    for (const email of SEED_EMAILS) {
      const res = await login(email, knownPassword).expect(201);
      const body = res.body as { access_token: string; refresh_token: string };
      seedSessions.push({
        email,
        token: body.access_token,
        refreshToken: body.refresh_token,
      });
    }

    await migrate(new DisableSeedAccounts1709800000011());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects the known password for every seed account', async () => {
    for (const email of SEED_EMAILS) {
      await login(email, knownPassword).expect(401);
    }
  });

  it('revokes their access and refresh tokens', async () => {
    for (const session of seedSessions) {
      await getMe(session.token).expect(401);
      await refresh(session.refreshToken).expect(401);
    }
  });

  it('keeps the rows and the coach link, with an unusable password', async () => {
    for (const email of SEED_EMAILS) {
      expect((await seedUser(email)).passwordHash).toBe('!deleted');
    }
    const coach = await seedUser('coach@liftbig.com');
    const client = await seedUser('mockuser@liftbig.com');
    expect(client.coachId).toBe(coach.id);
  });

  it('leaves other accounts signed in and able to log in', async () => {
    await getMe(other.token).expect(200);
    await login(other.email, other.password).expect(201);
  });
});
