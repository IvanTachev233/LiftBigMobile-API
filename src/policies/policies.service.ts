import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  AgreementItems,
  agreementItems,
  consentState,
  PendingAgreement,
  pendingAgreements,
} from './agreements';
import { ConsentEvent } from './consent-event.entity';
import { RecordAcceptancesDto, SetConsentDto } from './dto/agreement.dto';
import { PolicyAcceptance } from './policy-acceptance.entity';
import { AgreementSource, ConsentPurpose } from './policy-versions';

// What the user payload says about terms and consents
export interface AgreementStatus {
  needsAcceptance: PendingAgreement[];
  consents: Record<ConsentPurpose, boolean>;
  consentsUpdatedAt: Record<ConsentPurpose, Date | null>;
}

export interface AgreementContext {
  source?: AgreementSource;
  appVersionCode?: number;
}

@Injectable()
export class PoliciesService {
  constructor(
    @InjectRepository(PolicyAcceptance)
    private readonly acceptances: Repository<PolicyAcceptance>,
    @InjectRepository(ConsentEvent)
    private readonly consentEvents: Repository<ConsentEvent>,
  ) {}

  /** Adds the rows for checked items in the caller's transaction */
  async record(
    manager: EntityManager,
    userId: string,
    items: AgreementItems,
    { source = AgreementSource.APP, appVersionCode }: AgreementContext,
  ): Promise<void> {
    const now = new Date();
    if (items.documents.length) {
      await manager.insert(
        PolicyAcceptance,
        items.documents.map(({ document, version }) => ({
          userId,
          document,
          version,
          acceptedAt: now,
          source,
          appVersionCode: appVersionCode ?? null,
        })),
      );
    }
    if (items.consents.length) {
      await manager.insert(
        ConsentEvent,
        items.consents.map(({ purpose, granted, textVersion }) => ({
          userId,
          purpose,
          granted,
          textVersion,
          createdAt: now,
          source,
        })),
      );
    }
  }

  async status(userId: string): Promise<AgreementStatus> {
    const accepted = await this.acceptances
      .createQueryBuilder('acceptance')
      .select(['acceptance.document', 'acceptance.version'])
      .distinct(true)
      .where('acceptance.userId = :userId', { userId })
      .getMany();
    const latest = await this.consentEvents
      .createQueryBuilder('event')
      .distinctOn(['event.purpose'])
      .where('event.userId = :userId', { userId })
      .orderBy('event.purpose')
      .addOrderBy('event.id', 'DESC')
      .getMany();
    return {
      needsAcceptance: pendingAgreements(accepted, latest),
      ...consentState(latest),
    };
  }

  /** The update screen: records what was accepted and chosen there */
  async accept(userId: string, dto: RecordAcceptancesDto): Promise<void> {
    const items = agreementItems(dto, { signUp: false });
    await this.acceptances.manager.transaction((manager) =>
      this.record(manager, userId, items, dto),
    );
  }

  /** Appends one consent event; a required consent can't be withdrawn */
  async setConsent(
    userId: string,
    purpose: ConsentPurpose,
    dto: SetConsentDto,
  ): Promise<void> {
    const { granted, textVersion, source } = dto;
    const items = agreementItems(
      { consents: { [purpose]: { granted, textVersion } } },
      { signUp: false },
    );
    await this.record(this.consentEvents.manager, userId, items, { source });
  }
}
