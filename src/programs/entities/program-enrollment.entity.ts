import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/user.entity';
import { ProgramTemplate } from './program-template.entity';

export enum ProgramEnrollmentStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
}

// A user's run of one exact template version.
@Entity('program_enrollment')
@Index(['userId'], { unique: true, where: `"status" = 'ACTIVE'` })
export class ProgramEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  programId: string;

  @ManyToOne(() => ProgramTemplate, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'programId' })
  program: ProgramTemplate;

  @Column({ type: 'integer' })
  programVersion: number;

  // Local calendar date, YYYY-MM-DD.
  @Column({ type: 'date' })
  startDate: string;

  @Column({
    type: 'enum',
    enum: ProgramEnrollmentStatus,
    default: ProgramEnrollmentStatus.ACTIVE,
  })
  status: ProgramEnrollmentStatus;

  // The 1RMs entered at enrollment, in kg, keyed by exercise id.
  @Column({ type: 'jsonb' })
  maxesSnapshot: Record<string, number>;

  @CreateDateColumn()
  createdAt: Date;
}
