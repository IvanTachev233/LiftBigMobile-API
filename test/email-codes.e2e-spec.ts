import { HttpException, INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  EmailCode,
  EmailCodePurpose,
} from '../src/email-codes/email-code.entity';
import { EmailCodeService } from '../src/email-codes/email-code.service';
import { createE2eApp, E2eUser, registerAndLogin, sentMails } from './e2e-app';

// The service on the real schema: locks, enum, limits and the cascade.
describe('Email codes (e2e)', () => {
  let app: INestApplication<App>;
  let codes: EmailCodeService;
  let user: E2eUser;

  const codeIn = (text: string) => /\b(\d{6})\b/.exec(text)![1];
  const statusOf = (promise: Promise<unknown>) =>
    promise.then(
      () => 200,
      (error: HttpException) => error.getStatus(),
    );

  beforeAll(async () => {
    app = await createE2eApp();
    codes = app.get(EmailCodeService);
  });

  beforeEach(async () => {
    user = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('mails a code that verifies once and stores only its hash', async () => {
    await codes.issue(user, EmailCodePurpose.VERIFY_EMAIL);
    const mail = sentMails(app).lastTo(user.email)!;
    const code = codeIn(mail.text);

    const rows = await app
      .get(DataSource)
      .getRepository(EmailCode)
      .findBy({ userId: user.id });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);

    await codes.verify(user.id, EmailCodePurpose.VERIFY_EMAIL, code);
    expect(
      await statusOf(
        codes.verify(user.id, EmailCodePurpose.VERIFY_EMAIL, code),
      ),
    ).toBe(409);
  });

  it('holds the cooldown in the database', async () => {
    await codes.issue(user, EmailCodePurpose.RESET_PASSWORD);
    expect(
      await statusOf(codes.issue(user, EmailCodePurpose.RESET_PASSWORD)),
    ).toBe(429);
  });

  it('answers concurrent requests with one code and one 429', async () => {
    const results = await Promise.all([
      statusOf(codes.issue(user, EmailCodePurpose.VERIFY_EMAIL)),
      statusOf(codes.issue(user, EmailCodePurpose.VERIFY_EMAIL)),
    ]);
    expect(results.sort()).toEqual([200, 429]);
  });

  it('counts wrong entries', async () => {
    await codes.issue(user, EmailCodePurpose.VERIFY_EMAIL);
    const code = codeIn(sentMails(app).lastTo(user.email)!.text);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(
      codes.verify(user.id, EmailCodePurpose.VERIFY_EMAIL, wrong),
    ).rejects.toMatchObject({ response: { attemptsLeft: 4 } });
  });

  it('goes with the user', async () => {
    await codes.issue(user, EmailCodePurpose.VERIFY_EMAIL);
    const dataSource = app.get(DataSource);
    await dataSource.query(`DELETE FROM "user" WHERE "id" = $1`, [user.id]);
    expect(
      await dataSource.getRepository(EmailCode).countBy({ userId: user.id }),
    ).toBe(0);
  });
});
