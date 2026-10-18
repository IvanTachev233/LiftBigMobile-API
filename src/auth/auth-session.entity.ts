import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

// One signed-in device. The device holds a refresh token; only its hash is
// stored, and every refresh replaces it (see AuthSessionService).
@Entity('auth_session')
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  // SHA-256 of the refresh token the device holds now
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  tokenHash: string;

  // SHA-256 of the token the last rotation replaced
  @Index()
  @Column({ type: 'varchar', nullable: true })
  previousHash: string | null;

  // When previousHash was replaced; it is accepted again for 60 s after
  @Column({ type: 'timestamp', nullable: true })
  rotatedAt: Date | null;

  // The user's token version at sign-in; a raise ends the session
  @Column({ type: 'int' })
  tokenVersion: number;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  lastUsedAt: Date;

  // lastUsedAt plus the idle limit
  @Column({ type: 'timestamp' })
  idleExpiresAt: Date;

  // createdAt plus the absolute limit; never moves
  @Column({ type: 'timestamp' })
  absoluteExpiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
