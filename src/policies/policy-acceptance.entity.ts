import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { AgreementSource, PolicyDocument } from './policy-versions';

// A user accepting the Terms of Use, or being shown the Privacy Policy, at
// one version. Rows are only added, never changed; they go with the account.
@Entity('policy_acceptance')
export class PolicyAcceptance {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar' })
  document: PolicyDocument;

  @Column({ type: 'varchar' })
  version: string;

  @Column({ type: 'timestamp' })
  acceptedAt: Date;

  @Column({ type: 'varchar' })
  source: AgreementSource;

  // The Android versionCode of the app that sent it, when it said
  @Column({ type: 'int', nullable: true })
  appVersionCode: number | null;
}
