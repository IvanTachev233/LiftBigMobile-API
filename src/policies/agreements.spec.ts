import { BadRequestException } from '@nestjs/common';
import {
  agreementItems,
  consentState,
  CurrentVersions,
  pendingAgreements,
} from './agreements';
import {
  ConsentPurpose,
  PolicyDocument,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from './policy-versions';

const current: CurrentVersions = {
  documents: { terms: 'T2', privacy: 'P2' },
  consents: { health_data: 'H2', video_training: 'V2', product_emails: 'E2' },
};

const signUp = {
  acceptTerms: { terms: 'T2', privacy: 'P2' },
  consents: { health_data: { granted: true, textVersion: 'H2' } },
};

function message(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string }).message;
    }
    throw error;
  }
  throw new Error('Expected a 400');
}

describe('policy versions', () => {
  it('start at the approved texts of 2026-10-21', () => {
    expect(TERMS_VERSION).toBe('2026-10-21');
    expect(PRIVACY_VERSION).toBe('2026-10-21');
  });
});

describe('agreementItems', () => {
  it('turns a sign-up into both documents and the consents sent', () => {
    const items = agreementItems(
      {
        ...signUp,
        consents: {
          ...signUp.consents,
          video_training: { granted: false, textVersion: 'V2' },
        },
      },
      { signUp: true },
      current,
    );
    expect(items).toEqual({
      documents: [
        { document: PolicyDocument.TERMS, version: 'T2' },
        { document: PolicyDocument.PRIVACY, version: 'P2' },
      ],
      consents: [
        {
          purpose: ConsentPurpose.HEALTH_DATA,
          granted: true,
          textVersion: 'H2',
        },
        {
          purpose: ConsentPurpose.VIDEO_TRAINING,
          granted: false,
          textVersion: 'V2',
        },
      ],
    });
  });

  it.each([
    ['no acceptTerms', { consents: signUp.consents }],
    ['no terms', { ...signUp, acceptTerms: { privacy: 'P2' } }],
    ['no privacy', { ...signUp, acceptTerms: { terms: 'T2' } }],
  ])('refuses a sign-up with %s', (_, input) => {
    expect(
      message(() => agreementItems(input, { signUp: true }, current)),
    ).toBe(
      "Accept the Terms of Use and confirm you've read the Privacy Policy",
    );
  });

  it.each([
    ['terms', { terms: 'T1', privacy: 'P2' }, 'Terms of Use version T1'],
    ['privacy', { terms: 'T2', privacy: 'P1' }, 'Privacy Policy version P1'],
  ])('refuses an outdated %s version', (_, acceptTerms, named) => {
    expect(
      message(() =>
        agreementItems({ ...signUp, acceptTerms }, { signUp: true }, current),
      ),
    ).toBe(`${named} is out of date`);
  });

  it.each([
    ['missing', {}],
    ['refused', { health_data: { granted: false, textVersion: 'H2' } }],
  ])('refuses a sign-up with the training data consent %s', (_, consents) => {
    expect(
      message(() =>
        agreementItems({ ...signUp, consents }, { signUp: true }, current),
      ),
    ).toMatch(/^Agree to health_data|^health_data can't be refused/);
  });

  it('refuses an outdated consent text, required or optional', () => {
    for (const consents of [
      { health_data: { granted: true, textVersion: 'H1' } },
      {
        ...signUp.consents,
        product_emails: { granted: true, textVersion: 'E1' },
      },
    ]) {
      expect(
        message(() =>
          agreementItems({ ...signUp, consents }, { signUp: true }, current),
        ),
      ).toMatch(/text version [HE]1 is out of date$/);
    }
  });

  it('takes any part on the update screen, but not nothing', () => {
    expect(
      agreementItems(
        { acceptTerms: { privacy: 'P2' } },
        { signUp: false },
        current,
      ),
    ).toEqual({
      documents: [{ document: PolicyDocument.PRIVACY, version: 'P2' }],
      consents: [],
    });
    expect(message(() => agreementItems({}, { signUp: false }, current))).toBe(
      'Send acceptTerms or consents',
    );
  });

  it('never lets a required consent be refused after sign-up', () => {
    expect(
      message(() =>
        agreementItems(
          { consents: { health_data: { granted: false, textVersion: 'H2' } } },
          { signUp: false },
          current,
        ),
      ),
    ).toBe("health_data can't be refused; to withdraw it, delete your account");
  });
});

describe('pendingAgreements', () => {
  const healthGranted = {
    purpose: ConsentPurpose.HEALTH_DATA,
    granted: true,
    textVersion: 'H2',
  };

  it('lists everything for a user with no records', () => {
    expect(pendingAgreements([], [], current)).toEqual([
      'terms',
      'privacy',
      'health_data',
    ]);
  });

  it('lists nothing once the current versions are accepted and granted', () => {
    const accepted = [
      { document: PolicyDocument.TERMS, version: 'T2' },
      { document: PolicyDocument.PRIVACY, version: 'P2' },
    ];
    expect(pendingAgreements(accepted, [healthGranted], current)).toEqual([]);
  });

  it('lists a document again after a version bump', () => {
    const accepted = [
      { document: PolicyDocument.TERMS, version: 'T2' },
      { document: PolicyDocument.PRIVACY, version: 'P2' },
    ];
    const bumped = { ...current, documents: { terms: 'T3', privacy: 'P2' } };
    expect(pendingAgreements(accepted, [healthGranted], bumped)).toEqual([
      'terms',
    ]);
  });

  it('lists the required consent when its text changed', () => {
    const bumped = {
      ...current,
      consents: { ...current.consents, health_data: 'H3' },
    };
    const accepted = [
      { document: PolicyDocument.TERMS, version: 'T2' },
      { document: PolicyDocument.PRIVACY, version: 'P2' },
    ];
    expect(pendingAgreements(accepted, [healthGranted], bumped)).toEqual([
      'health_data',
    ]);
  });

  it('ignores optional consents', () => {
    const accepted = [
      { document: PolicyDocument.TERMS, version: 'T2' },
      { document: PolicyDocument.PRIVACY, version: 'P2' },
    ];
    const latest = [
      healthGranted,
      {
        purpose: ConsentPurpose.VIDEO_TRAINING,
        granted: false,
        textVersion: 'V1',
      },
    ];
    expect(pendingAgreements(accepted, latest, current)).toEqual([]);
  });
});

describe('consentState', () => {
  it('reports each purpose from its latest event, not granted without one', () => {
    const at = new Date('2026-10-24T10:00:00Z');
    expect(
      consentState([
        {
          purpose: ConsentPurpose.PRODUCT_EMAILS,
          granted: true,
          createdAt: at,
        },
      ]),
    ).toEqual({
      consents: {
        health_data: false,
        video_training: false,
        product_emails: true,
      },
      consentsUpdatedAt: {
        health_data: null,
        video_training: null,
        product_emails: at,
      },
    });
  });
});
