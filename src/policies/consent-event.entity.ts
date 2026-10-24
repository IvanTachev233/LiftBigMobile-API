import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { AgreementSource, ConsentPurpose } from './policy-versions';

// A user giving or withdrawing one consent, with the wording version they
// saw. Rows are only added, never changed; the highest id per purpose is the
// current state. They go with the account.
@Entity('consent_event')
export class ConsentEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar' })
  purpose: ConsentPurpose;

  @Column({ type: 'boolean' })
  granted: boolean;

  @Column({ type: 'varchar' })
  textVersion: string;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'varchar' })
  source: AgreementSource;
}
