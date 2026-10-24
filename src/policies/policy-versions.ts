// Current versions of the public documents and the consent texts: the date
// the text took effect. A change users must see gets a new version, and every
// user who hasn't accepted (or been shown) it is asked again. Each consent
// wording, old and new, is kept in docs/privacy/consent-texts.md.
export const TERMS_VERSION = '2026-10-21';
export const PRIVACY_VERSION = '2026-10-21';

export enum PolicyDocument {
  TERMS = 'terms',
  PRIVACY = 'privacy',
}

export enum ConsentPurpose {
  // Required: explicit consent to store training data, which can be health data
  HEALTH_DATA = 'health_data',
  VIDEO_TRAINING = 'video_training',
  PRODUCT_EMAILS = 'product_emails',
}

export const DOCUMENT_VERSIONS: Record<PolicyDocument, string> = {
  [PolicyDocument.TERMS]: TERMS_VERSION,
  [PolicyDocument.PRIVACY]: PRIVACY_VERSION,
};

export const CONSENT_TEXT_VERSIONS: Record<ConsentPurpose, string> = {
  [ConsentPurpose.HEALTH_DATA]: '2026-10-21',
  [ConsentPurpose.VIDEO_TRAINING]: '2026-10-21',
  [ConsentPurpose.PRODUCT_EMAILS]: '2026-10-21',
};

// No account without these; withdrawing one means deleting the account
export const REQUIRED_CONSENTS: readonly ConsentPurpose[] = [
  ConsentPurpose.HEALTH_DATA,
];

// Where an acceptance or consent was given
export enum AgreementSource {
  APP = 'app',
  WEB = 'web',
}
