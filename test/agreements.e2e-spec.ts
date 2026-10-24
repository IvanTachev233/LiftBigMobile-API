import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { ConsentEvent } from '../src/policies/consent-event.entity';
import { PolicyAcceptance } from '../src/policies/policy-acceptance.entity';
import {
  CONSENT_TEXT_VERSIONS,
  ConsentPurpose,
  PolicyDocument,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '../src/policies/policy-versions';
import {
  createE2eApp,
  createExistingUser,
  E2eUser,
  mailedCode,
  registerAndLogin,
  sentMails,
  SIGN_UP_AGREEMENT,
} from './e2e-app';

const healthData = {
  granted: true,
  textVersion: CONSENT_TEXT_VERSIONS.health_data,
};
const videoTraining = (granted: boolean) => ({
  granted,
  textVersion: CONSENT_TEXT_VERSIONS.video_training,
});
const productEmails = (granted: boolean) => ({
  granted,
  textVersion: CONSENT_TEXT_VERSIONS.product_emails,
});
const currentDocuments = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };

interface Payload {
  needsAcceptance: string[];
  consents: Record<string, boolean>;
  consentsUpdatedAt: Record<string, string | null>;
}

// Terms and privacy acceptance and consent records: sign-up, existing users,
// consent changes and account deletion (LB-32 G1a).
describe('Agreements (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const server = () => app.getHttpServer();
  const register = (email: string, body: object) =>
    request(server())
      .post('/auth/register')
      .send({ name: 'New Lifter', email, password: 'password123', ...body });
  const getMe = (user: E2eUser) =>
    request(server())
      .get('/users/me')
      .set('Authorization', `Bearer ${user.token}`);
  const accept = (user: E2eUser, body: object) =>
    request(server())
      .post('/users/me/acceptances')
      .set('Authorization', `Bearer ${user.token}`)
      .send(body);
  const setConsent = (user: E2eUser, purpose: string, body: object) =>
    request(server())
      .put(`/users/me/consents/${purpose}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send(body);
  const acceptances = (userId: string) =>
    dataSource
      .getRepository(PolicyAcceptance)
      .find({ where: { userId }, order: { id: 'ASC' } });
  const events = (userId: string) =>
    dataSource
      .getRepository(ConsentEvent)
      .find({ where: { userId }, order: { id: 'ASC' } });
  const userId = async (email: string) =>
    (await dataSource.getRepository(User).findOneByOrFail({ email })).id;
  const userExists = (email: string) =>
    dataSource.getRepository(User).existsBy({ email });
  const verifyAndLogin = async (email: string): Promise<E2eUser> => {
    await request(server())
      .post('/auth/verify-email')
      .send({ email, code: mailedCode(app, email) })
      .expect(200);
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    const body = res.body as { access_token: string; refresh_token: string };
    return {
      id: await userId(email),
      email,
      password: 'password123',
      token: body.access_token,
      refreshToken: body.refresh_token,
    };
  };
  const newEmail = () => `e2e-agree-${randomUUID()}@example.com`;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /policies', () => {
    it('returns the current versions without auth', async () => {
      const res = await request(server()).get('/policies').expect(200);
      expect(res.body).toEqual({
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        consentTextVersions: CONSENT_TEXT_VERSIONS,
      });
    });
  });

  describe('sign up', () => {
    it.each([
      ['without acceptTerms', { consents: { health_data: healthData } }],
      [
        'without privacy',
        {
          acceptTerms: { terms: TERMS_VERSION },
          consents: { health_data: healthData },
        },
      ],
      [
        'with an old Terms version',
        {
          acceptTerms: { ...currentDocuments, terms: '2026-01-01' },
          consents: { health_data: healthData },
        },
      ],
      [
        'with an old Privacy version',
        {
          acceptTerms: { ...currentDocuments, privacy: '2026-01-01' },
          consents: { health_data: healthData },
        },
      ],
      ['without the training data consent', { acceptTerms: currentDocuments }],
      [
        'with the training data consent refused',
        {
          acceptTerms: currentDocuments,
          consents: { health_data: { ...healthData, granted: false } },
        },
      ],
      [
        'with an old training data text',
        {
          acceptTerms: currentDocuments,
          consents: {
            health_data: { ...healthData, textVersion: '2026-01-01' },
          },
        },
      ],
      [
        'with an old optional consent text',
        {
          ...SIGN_UP_AGREEMENT,
          consents: {
            health_data: healthData,
            video_training: { granted: true, textVersion: '2026-01-01' },
          },
        },
      ],
      [
        'with acceptTerms that is not an object',
        { ...SIGN_UP_AGREEMENT, acceptTerms: 'yes' },
      ],
    ])(
      'refuses a sign-up %s with 400 and creates no account',
      async (_, body) => {
        const email = newEmail();
        await register(email, body).expect(400);
        expect(await userExists(email)).toBe(false);
      },
    );

    it('stores the accepted versions and the consents with the account', async () => {
      const email = newEmail();
      await register(email, {
        acceptTerms: currentDocuments,
        consents: {
          health_data: healthData,
          video_training: videoTraining(false),
          product_emails: productEmails(true),
        },
        appVersionCode: 7,
      }).expect(201);
      const id = await userId(email);

      const docs = await acceptances(id);
      expect(
        docs.map(({ document, version, source, appVersionCode }) => ({
          document,
          version,
          source,
          appVersionCode,
        })),
      ).toEqual([
        {
          document: 'terms',
          version: TERMS_VERSION,
          source: 'app',
          appVersionCode: 7,
        },
        {
          document: 'privacy',
          version: PRIVACY_VERSION,
          source: 'app',
          appVersionCode: 7,
        },
      ]);
      expect(docs[0].acceptedAt).toBeInstanceOf(Date);
      expect(
        (await events(id)).map(({ purpose, granted, textVersion, source }) => ({
          purpose,
          granted,
          textVersion,
          source,
        })),
      ).toEqual([
        {
          purpose: 'health_data',
          granted: true,
          textVersion: CONSENT_TEXT_VERSIONS.health_data,
          source: 'app',
        },
        {
          purpose: 'video_training',
          granted: false,
          textVersion: CONSENT_TEXT_VERSIONS.video_training,
          source: 'app',
        },
        {
          purpose: 'product_emails',
          granted: true,
          textVersion: CONSENT_TEXT_VERSIONS.product_emails,
          source: 'app',
        },
      ]);

      const me = (await getMe(await verifyAndLogin(email)).expect(200))
        .body as Payload;
      expect(me.needsAcceptance).toEqual([]);
      expect(me.consents).toEqual({
        health_data: true,
        video_training: false,
        product_emails: true,
      });
      for (const at of Object.values(me.consentsUpdatedAt)) {
        expect(typeof at).toBe('string');
      }
    });

    it('leaves no rows when the code mail cannot be sent', async () => {
      const count = () =>
        Promise.all([
          dataSource.getRepository(PolicyAcceptance).count(),
          dataSource.getRepository(ConsentEvent).count(),
        ]);
      const before = await count();
      const spy = jest
        .spyOn(sentMails(app), 'send')
        .mockRejectedValueOnce(new Error('mail down'));
      const email = newEmail();
      try {
        await register(email, SIGN_UP_AGREEMENT).expect(503);
      } finally {
        spy.mockRestore();
      }

      expect(await userExists(email)).toBe(false);
      expect(await count()).toEqual(before);
    });

    it('records the web as the source, and no app version when none is sent', async () => {
      const email = newEmail();
      await register(email, { ...SIGN_UP_AGREEMENT, source: 'web' }).expect(
        201,
      );
      const id = await userId(email);

      expect((await acceptances(id)).map((row) => row.source)).toEqual([
        'web',
        'web',
      ]);
      expect((await acceptances(id))[0].appVersionCode).toBeNull();
      expect((await events(id)).map((row) => row.source)).toEqual(['web']);
    });

    it('refuses an unknown source or a bad app version', async () => {
      for (const extra of [
        { source: 'fax' },
        { appVersionCode: 0 },
        { appVersionCode: 1.5 },
      ]) {
        const email = newEmail();
        await register(email, { ...SIGN_UP_AGREEMENT, ...extra }).expect(400);
        expect(await userExists(email)).toBe(false);
      }
    });

    it('leaves an optional purpose not sent without an event', async () => {
      const user = await registerAndLogin(app);
      const me = (await getMe(user).expect(200)).body as Payload;
      expect(me.consents.video_training).toBe(false);
      expect(me.consentsUpdatedAt.video_training).toBeNull();
      expect(me.consentsUpdatedAt.product_emails).toBeNull();
    });
  });

  describe('existing users', () => {
    it('lists both documents and the training data consent for a user with no records', async () => {
      const user = await createExistingUser(app);
      const me = (await getMe(user).expect(200)).body as Payload;
      expect(me.needsAcceptance).toEqual(['terms', 'privacy', 'health_data']);
      expect(me.consents).toEqual({
        health_data: false,
        video_training: false,
        product_emails: false,
      });
      expect(me.consentsUpdatedAt).toEqual({
        health_data: null,
        video_training: null,
        product_emails: null,
      });
    });

    it('still lets them use the API before accepting (no 403)', async () => {
      const user = await createExistingUser(app);
      await request(server())
        .patch('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ restSeconds: 90 })
        .expect(200);
      await request(server())
        .get('/workouts')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
    });

    it('empties the list after accepting, and stays empty', async () => {
      const user = await createExistingUser(app);
      const res = await accept(user, {
        ...SIGN_UP_AGREEMENT,
        consents: {
          health_data: healthData,
          product_emails: productEmails(false),
        },
        appVersionCode: 3,
      }).expect(200);

      const body = res.body as Payload;
      expect(body.needsAcceptance).toEqual([]);
      expect(body.consents.product_emails).toBe(false);
      expect(typeof body.consentsUpdatedAt.product_emails).toBe('string');
      expect(
        ((await getMe(user).expect(200)).body as Payload).needsAcceptance,
      ).toEqual([]);
      expect((await acceptances(user.id)).map((r) => r.appVersionCode)).toEqual(
        [3, 3],
      );
    });

    it('keeps what was not accepted in the list', async () => {
      const user = await createExistingUser(app);
      const res = await accept(user, {
        acceptTerms: { privacy: PRIVACY_VERSION },
      }).expect(200);
      expect((res.body as Payload).needsAcceptance).toEqual([
        'terms',
        'health_data',
      ]);
    });

    it('lists a document again when only an earlier version was accepted', async () => {
      const user = await createExistingUser(app);
      await accept(user, SIGN_UP_AGREEMENT).expect(200);
      // What a version bump looks like: the stored rows name another version
      await dataSource
        .getRepository(PolicyAcceptance)
        .update(
          { userId: user.id, document: PolicyDocument.TERMS },
          { version: '2026-01-01' },
        );
      await dataSource
        .getRepository(ConsentEvent)
        .update({ userId: user.id }, { textVersion: '2026-01-01' });

      expect(
        ((await getMe(user).expect(200)).body as Payload).needsAcceptance,
      ).toEqual(['terms', 'health_data']);
      const res = await accept(user, SIGN_UP_AGREEMENT).expect(200);
      expect((res.body as Payload).needsAcceptance).toEqual([]);
    });

    it.each([
      ['an old Terms version', { acceptTerms: { terms: '2026-01-01' } }],
      [
        'an old training data text',
        {
          consents: {
            health_data: { ...healthData, textVersion: '2026-01-01' },
          },
        },
      ],
      [
        'the training data consent refused',
        { consents: { health_data: { ...healthData, granted: false } } },
      ],
      ['nothing to record', {}],
    ])('refuses %s with 400 and records nothing', async (_, body) => {
      const user = await createExistingUser(app);
      await accept(user, body).expect(400);
      expect(await acceptances(user.id)).toEqual([]);
      expect(await events(user.id)).toEqual([]);
    });

    it('needs a login', async () => {
      await request(server())
        .post('/users/me/acceptances')
        .send(SIGN_UP_AGREEMENT)
        .expect(401);
      await request(server())
        .put('/users/me/consents/product_emails')
        .send(productEmails(true))
        .expect(401);
    });
  });

  describe('PUT /users/me/consents/:purpose', () => {
    it('appends an event per change and reports the latest', async () => {
      const user = await registerAndLogin(app);

      const on = await setConsent(
        user,
        'video_training',
        videoTraining(true),
      ).expect(200);
      expect((on.body as Payload).consents.video_training).toBe(true);
      const off = await setConsent(
        user,
        'video_training',
        videoTraining(false),
      ).expect(200);
      expect((off.body as Payload).consents.video_training).toBe(false);

      const toggles = (await events(user.id)).filter(
        (event) => event.purpose === ConsentPurpose.VIDEO_TRAINING,
      );
      expect(toggles.map((event) => event.granted)).toEqual([true, false]);
      const me = (await getMe(user).expect(200)).body as Payload;
      expect(me.consents.video_training).toBe(false);
      expect(me.consents.health_data).toBe(true);
    });

    it('refuses an unknown purpose', async () => {
      const user = await registerAndLogin(app);
      await setConsent(user, 'telemarketing', {
        granted: true,
        textVersion: '2026-10-21',
      }).expect(400);
    });

    it('refuses an old text version or a missing choice', async () => {
      const user = await registerAndLogin(app);
      const before = (await events(user.id)).length;
      await setConsent(user, 'product_emails', {
        granted: true,
        textVersion: '2026-01-01',
      }).expect(400);
      await setConsent(user, 'product_emails', {
        textVersion: CONSENT_TEXT_VERSIONS.product_emails,
      }).expect(400);
      await setConsent(user, 'product_emails', {
        granted: 'yes',
        textVersion: CONSENT_TEXT_VERSIONS.product_emails,
      }).expect(400);
      expect(await events(user.id)).toHaveLength(before);
    });

    it('refuses withdrawing the training data consent', async () => {
      const user = await registerAndLogin(app);
      const res = await setConsent(user, 'health_data', {
        ...healthData,
        granted: false,
      }).expect(400);
      expect((res.body as { message: string }).message).toContain(
        'delete your account',
      );
    });

    it('lets an existing user grant the training data consent', async () => {
      const user = await createExistingUser(app);
      const res = await setConsent(user, 'health_data', healthData).expect(200);
      expect((res.body as Payload).needsAcceptance).toEqual([
        'terms',
        'privacy',
      ]);
    });
  });

  describe('account deletion', () => {
    it.each(['CLIENT', 'COACH'] as const)(
      'removes every acceptance and consent row of a %s',
      async (role) => {
        const user = await registerAndLogin(app, role);
        await setConsent(user, 'product_emails', productEmails(true)).expect(
          200,
        );
        expect(await acceptances(user.id)).toHaveLength(2);

        await request(server())
          .delete('/users/me')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ password: user.password })
          .expect(204);

        expect(await acceptances(user.id)).toEqual([]);
        expect(await events(user.id)).toEqual([]);
      },
    );
  });
});
