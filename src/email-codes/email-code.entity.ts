import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';

export enum EmailCodePurpose {
  VERIFY_EMAIL = 'VERIFY_EMAIL',
  RESET_PASSWORD = 'RESET_PASSWORD',
}

// One mailed one-time code. Every send adds a row; only the newest row per
// user and purpose can be entered, older ones stay to count the hourly limit.
@Entity('email_code')
@Index(['userId', 'purpose', 'createdAt'])
export class EmailCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: EmailCodePurpose })
  purpose: EmailCodePurpose;

  // HMAC-SHA256 of the code; the code itself is never stored
  @Column({ type: 'varchar' })
  codeHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  // Wrong entries so far
  @Column({ type: 'int', default: 0 })
  attempts: number;

  // Set once the right code was entered
  @Column({ type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
