import { BadRequestException } from '@nestjs/common';
import {
  CONSENT_TEXT_VERSIONS,
  ConsentPurpose,
  DOCUMENT_VERSIONS,
  PolicyDocument,
  REQUIRED_CONSENTS,
} from './policy-versions';

export interface CurrentVersions {
  documents: Record<PolicyDocument, string>;
  consents: Record<ConsentPurpose, string>;
}

const CURRENT: CurrentVersions = {
  documents: DOCUMENT_VERSIONS,
  consents: CONSENT_TEXT_VERSIONS,
};

const DOCUMENT_NAMES: Record<PolicyDocument, string> = {
  [PolicyDocument.TERMS]: 'Terms of Use',
  [PolicyDocument.PRIVACY]: 'Privacy Policy',
};

export interface ConsentChoice {
  granted: boolean;
  textVersion: string;
}

// What a sign-up or the update screen sends
export interface AgreementInput {
  acceptTerms?: Partial<Record<PolicyDocument, string>>;
  consents?: Partial<Record<ConsentPurpose, ConsentChoice>>;
}

// The rows to write for an AgreementInput
export interface AgreementItems {
  documents: { document: PolicyDocument; version: string }[];
  consents: ({ purpose: ConsentPurpose } & ConsentChoice)[];
}

// Something the user still has to accept, or a required consent to grant
export type PendingAgreement = PolicyDocument | ConsentPurpose;

/**
 * Checks an AgreementInput against the current versions: every version sent
 * must be current and a required consent can't be refused. A sign-up must
 * accept both documents and grant every required consent; on the update
 * screen any part will do, but not nothing. Throws 400.
 */
export function agreementItems(
  input: AgreementInput,
  { signUp }: { signUp: boolean },
  current: CurrentVersions = CURRENT,
): AgreementItems {
  const documents: AgreementItems['documents'] = [];
  for (const document of Object.values(PolicyDocument)) {
    const version = input.acceptTerms?.[document];
    if (version === undefined) {
      if (signUp) {
        throw new BadRequestException(
          "Accept the Terms of Use and confirm you've read the Privacy Policy",
        );
      }
      continue;
    }
    if (version !== current.documents[document]) {
      throw new BadRequestException(
        `${DOCUMENT_NAMES[document]} version ${version} is out of date`,
      );
    }
    documents.push({ document, version });
  }

  const consents: AgreementItems['consents'] = [];
  for (const purpose of Object.values(ConsentPurpose)) {
    const choice = input.consents?.[purpose];
    const required = REQUIRED_CONSENTS.includes(purpose);
    if (!choice) {
      if (signUp && required) {
        throw new BadRequestException(`Agree to ${purpose} to sign up`);
      }
      continue;
    }
    if (required && !choice.granted) {
      throw new BadRequestException(
        `${purpose} can't be refused; to withdraw it, delete your account`,
      );
    }
    if (choice.textVersion !== current.consents[purpose]) {
      throw new BadRequestException(
        `${purpose} text version ${choice.textVersion} is out of date`,
      );
    }
    consents.push({
      purpose,
      granted: choice.granted,
      textVersion: choice.textVersion,
    });
  }

  if (!signUp && documents.length === 0 && consents.length === 0) {
    throw new BadRequestException('Send acceptTerms or consents');
  }
  return { documents, consents };
}

/**
 * Documents whose current version the user hasn't accepted, then required
 * consents whose latest event isn't a grant of the current text.
 */
export function pendingAgreements(
  accepted: { document: PolicyDocument; version: string }[],
  latestConsents: ({ purpose: ConsentPurpose } & ConsentChoice)[],
  current: CurrentVersions = CURRENT,
): PendingAgreement[] {
  const pending: PendingAgreement[] = Object.values(PolicyDocument).filter(
    (document) =>
      !accepted.some(
        (row) =>
          row.document === document &&
          row.version === current.documents[document],
      ),
  );
  for (const purpose of REQUIRED_CONSENTS) {
    const latest = latestConsents.find((event) => event.purpose === purpose);
    if (!latest?.granted || latest.textVersion !== current.consents[purpose]) {
      pending.push(purpose);
    }
  }
  return pending;
}

/**
 * Each purpose's state from its latest event, and when that was; with no
 * event a purpose isn't granted and has no time.
 */
export function consentState(
  latestConsents: {
    purpose: ConsentPurpose;
    granted: boolean;
    createdAt: Date;
  }[],
): {
  consents: Record<ConsentPurpose, boolean>;
  consentsUpdatedAt: Record<ConsentPurpose, Date | null>;
} {
  const consents = {} as Record<ConsentPurpose, boolean>;
  const consentsUpdatedAt = {} as Record<ConsentPurpose, Date | null>;
  for (const purpose of Object.values(ConsentPurpose)) {
    const latest = latestConsents.find((event) => event.purpose === purpose);
    consents[purpose] = latest?.granted ?? false;
    consentsUpdatedAt[purpose] = latest?.createdAt ?? null;
  }
  return { consents, consentsUpdatedAt };
}
