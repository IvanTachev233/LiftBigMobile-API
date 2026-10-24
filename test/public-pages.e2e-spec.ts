import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import {
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '../src/policies/policy-versions';
import {
  createE2eApp,
  createExistingUser,
  registerAndLogin,
  sentMails,
  SIGN_UP_AGREEMENT,
} from './e2e-app';

// The public privacy policy, terms and account deletion pages, and the
// endpoint the deletion page posts to.
describe('Public pages (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const server = () => app.getHttpServer();
  const deleteWithCredentials = (body: object) =>
    request(server()).post('/delete-account').send(body);
  const login = (email: string, password: string) =>
    request(server()).post('/auth/login').send({ email, password });
  const userExists = (email: string) =>
    dataSource.getRepository(User).existsBy({ email });
  const mailsTo = (email: string) =>
    sentMails(app).sent.filter((mail) => mail.to === email).length;
  const sha256 = (text: string) =>
    `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  const inlineBlocks = (html: string, tag: 'script' | 'style') =>
    [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(
      (match) => match[1],
    );

  const genericError = {
    statusCode: 401,
    message: 'Email or password is incorrect',
  };

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each(['/privacy', '/terms', '/delete-account'])('GET %s', (path) => {
    it('is HTML served without auth, with restrictive headers', async () => {
      const res = await request(server()).get(path).expect(200);

      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBeDefined();
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.text).toMatch(/^<!doctype html>/i);
      expect(res.text).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
      );
      expect(res.text).toContain('prefers-color-scheme: light');
    });

    it('allows exactly its inline style and script by hash', async () => {
      const res = await request(server()).get(path).expect(200);
      const csp = res.headers['content-security-policy'];

      const styles = inlineBlocks(res.text, 'style');
      expect(styles).toHaveLength(1);
      expect(csp).toContain(`style-src ${sha256(styles[0])}`);
      for (const script of inlineBlocks(res.text, 'script')) {
        expect(csp).toContain(sha256(script));
      }
      expect(res.text).not.toMatch(/\sstyle="/);
      expect(res.text).not.toMatch(/\son[a-z]+="/);
    });
  });

  describe('GET /privacy', () => {
    const saved = {
      name: process.env.PRIVACY_OPERATOR_NAME,
      email: process.env.PRIVACY_CONTACT_EMAIL,
    };
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };

    afterEach(() => {
      restore('PRIVACY_OPERATOR_NAME', saved.name);
      restore('PRIVACY_CONTACT_EMAIL', saved.email);
    });

    it('states the data collected, processors, retention and deletion', async () => {
      const { text } = await request(server()).get('/privacy').expect(200);

      for (const item of [
        // Data collected
        'Email address',
        'Name',
        'Password hash',
        'Role',
        'Coach link',
        'Workouts',
        'Sets',
        'Lift records',
        'Settings',
        'weight unit',
        'rest timer',
        'Email codes',
        'Program enrollments',
        'invites',
        'Sessions',
        'Terms and policy acceptance',
        'Consent choices',
        // Purpose, legal basis, health data and choices
        'Legal basis',
        'Legitimate interests',
        '<strong>explicit consent</strong>',
        '<code>video_training</code>',
        '<code>product_emails</code>',
        'Profile → Privacy',
        // Processors, transfers, no ads or sharing
        'Google Cloud',
        'Cloud Run',
        'Neon',
        'AWS London',
        'Resend',
        'United States',
        'No ads',
        'No analytics',
        "We don't sell your data",
        // Retention, deletion, rights and complaints
        'Until you delete your account',
        '15 minutes',
        'Profile → Delete account',
        'href="delete-account"',
        'anonymised',
        "clients' history",
        'acceptance and consent records',
        'within one month',
        'href="https://ico.org.uk/make-a-complaint"',
        `Version ${PRIVACY_VERSION} · Last updated 21 October 2026`,
      ]) {
        expect(text).toContain(item);
      }
    });

    it('shows placeholders for the operator and contact when unset', async () => {
      delete process.env.PRIVACY_OPERATOR_NAME;
      delete process.env.PRIVACY_CONTACT_EMAIL;

      const { text } = await request(server()).get('/privacy').expect(200);

      expect(text).toContain('[OPERATOR NAME]');
      expect(text).toContain('[CONTACT EMAIL]');
    });

    it('shows the configured operator and contact, escaped', async () => {
      process.env.PRIVACY_OPERATOR_NAME = 'Lift & Co <b>"Ltd"</b>';
      process.env.PRIVACY_CONTACT_EMAIL = 'privacy+x@example.com';

      const { text } = await request(server()).get('/privacy').expect(200);

      expect(text).toContain(
        'Lift &amp; Co &lt;b&gt;&quot;Ltd&quot;&lt;/b&gt;',
      );
      expect(text).not.toContain('<b>"Ltd"</b>');
      expect(text).toContain('href="mailto:privacy+x@example.com"');
      expect(text).not.toContain('[OPERATOR NAME]');
      expect(text).not.toContain('[CONTACT EMAIL]');
    });
  });

  describe('GET /terms', () => {
    const saved = {
      name: process.env.PRIVACY_OPERATOR_NAME,
      email: process.env.PRIVACY_CONTACT_EMAIL,
    };

    afterEach(() => {
      for (const [key, value] of [
        ['PRIVACY_OPERATOR_NAME', saved.name],
        ['PRIVACY_CONTACT_EMAIL', saved.email],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('states its version, the age limit, safety, content, law and links', async () => {
      const { text } = await request(server()).get('/terms').expect(200);

      for (const item of [
        '<h1>Terms of Use</h1>',
        `Version ${TERMS_VERSION} · Last updated 21 October 2026`,
        '<strong>18 or older</strong>',
        '<strong>not medical advice</strong>',
        'Coaches and clients',
        'Your content',
        'Filming and videos',
        'Acceptable use',
        'paid features',
        'England and Wales',
        '£100',
        'href="privacy"',
        'href="delete-account"',
      ]) {
        expect(text).toContain(item);
      }
      expect(text).not.toContain('(review)');
    });

    it('shows the operator and contact like the privacy page', async () => {
      delete process.env.PRIVACY_OPERATOR_NAME;
      delete process.env.PRIVACY_CONTACT_EMAIL;
      const unset = (await request(server()).get('/terms').expect(200)).text;
      expect(unset).toContain('[OPERATOR NAME]');
      expect(unset).toContain('[CONTACT EMAIL]');

      process.env.PRIVACY_OPERATOR_NAME = 'Lift & Co';
      process.env.PRIVACY_CONTACT_EMAIL = 'privacy@example.com';
      const set = (await request(server()).get('/terms').expect(200)).text;
      expect(set).toContain('between you and Lift &amp; Co');
      expect(set).toContain('href="mailto:privacy@example.com"');
      expect(set).not.toContain('[OPERATOR NAME]');
    });
  });

  describe('GET /delete-account', () => {
    it('explains in-app deletion and has the form with a confirm step', async () => {
      const { text } = await request(server())
        .get('/delete-account')
        .expect(200);

      for (const item of [
        'Profile → Delete account',
        'unlinked',
        'type="email"',
        'type="password"',
        'action="delete-account"',
        'method="post"',
        'This deletes your account and cannot be undone.',
        'Your account has been deleted.',
        'Email or password is incorrect.',
        'Too many wrong passwords',
        'href="privacy"',
      ]) {
        expect(text).toContain(item);
      }
    });
  });

  describe('POST /delete-account', () => {
    it('deletes the account and the password no longer signs in', async () => {
      const page = await request(server()).get('/delete-account').expect(200);
      expect(page.text).toContain('action="delete-account"');
      const user = await registerAndLogin(app);

      await deleteWithCredentials({
        email: user.email,
        password: user.password,
        confirm: true,
      }).expect(204);

      expect(await userExists(user.email)).toBe(false);
      await login(user.email, user.password).expect(401);
      await request(server())
        .get('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(401);
    });

    it('anonymises a coach like DELETE /users/me', async () => {
      const coach = await registerAndLogin(app, 'COACH');

      await deleteWithCredentials({
        email: coach.email,
        password: coach.password,
        confirm: true,
      }).expect(204);

      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: coach.id });
      expect(row.email).toBe(`deleted-${coach.id}@deleted.invalid`);
      await login(coach.email, coach.password).expect(401);
    });

    it('needs the confirm flag, so a plain form post deletes nothing', async () => {
      const user = await createExistingUser(app);

      await deleteWithCredentials({
        email: user.email,
        password: user.password,
      }).expect(400);
      await request(server())
        .post('/delete-account')
        .type('form')
        .send({ email: user.email, password: user.password, confirm: 'true' })
        .expect(400);

      expect(await userExists(user.email)).toBe(true);
    });

    it('answers a wrong password with the generic error', async () => {
      const user = await createExistingUser(app);

      const res = await deleteWithCredentials({
        email: user.email,
        password: 'wrong-password',
        confirm: true,
      }).expect(401);

      expect(res.body).toEqual(genericError);
      expect(await userExists(user.email)).toBe(true);
    });

    it('answers an unknown email with the same error', async () => {
      const res = await deleteWithCredentials({
        email: `e2e-nobody-${randomUUID()}@example.com`,
        password: 'password123',
        confirm: true,
      }).expect(401);

      expect(res.body).toEqual(genericError);
    });

    it('answers an unverified account with the same error and mails nothing', async () => {
      const email = `e2e-unverified-${randomUUID()}@example.com`;
      await request(server())
        .post('/auth/register')
        .send({
          name: 'Unverified',
          email,
          password: 'password123',
          ...SIGN_UP_AGREEMENT,
        })
        .expect(201);
      const mailsBefore = mailsTo(email);

      for (const password of ['password123', 'wrong-password']) {
        const res = await deleteWithCredentials({
          email,
          password,
          confirm: true,
        }).expect(401);
        expect(res.body).toEqual(genericError);
      }

      expect(mailsTo(email)).toBe(mailsBefore);
      expect(await userExists(email)).toBe(true);
    });

    it('counts wrong passwords towards the Change password lock (429)', async () => {
      const user = await createExistingUser(app);
      const attempt = (password: string) =>
        deleteWithCredentials({ email: user.email, password, confirm: true });

      await attempt('wrong-1').expect(401);
      await attempt('wrong-2').expect(401);
      const locked = await attempt('wrong-3').expect(429);
      expect(locked.body).toMatchObject({ retryAfterMinutes: 15 });

      // The right password is blocked too, here and on Change password
      await attempt(user.password).expect(429);
      await request(server())
        .post('/users/me/password')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ currentPassword: user.password, newPassword: 'newpass123' })
        .expect(429);
      expect(await userExists(user.email)).toBe(true);
    });

    it('is blocked by a lock from Change password', async () => {
      const user = await createExistingUser(app);
      for (let i = 0; i < 3; i++) {
        await request(server())
          .post('/users/me/password')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ currentPassword: `wrong-${i}`, newPassword: 'newpass123' });
      }

      const res = await deleteWithCredentials({
        email: user.email,
        password: user.password,
        confirm: true,
      }).expect(429);

      expect(res.body).toMatchObject({ retryAfterMinutes: 15 });
      expect(await userExists(user.email)).toBe(true);
    });
  });
});
