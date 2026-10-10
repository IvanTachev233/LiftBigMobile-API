import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/user.entity';
import { ProgramTemplateSession } from './program-template-session.entity';
import { Sport } from './sport.entity';

export enum ProgramTemplateStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

// One version of a program. Versions of the same program share lineageId.
@Entity('program_template')
@Unique(['lineageId', 'version'])
export class ProgramTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  lineageId: string;

  @Column({ type: 'integer' })
  version: number;

  @Column({ type: 'uuid' })
  sportId: string;

  @ManyToOne(() => Sport, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'sportId' })
  sport: Sport;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'integer' })
  durationWeeks: number;

  @Column({ type: 'integer' })
  sessionsPerWeek: number;

  // null = written by the system.
  @Column({ type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'authorId' })
  author: User | null;

  @Column({
    type: 'enum',
    enum: ProgramTemplateStatus,
    default: ProgramTemplateStatus.DRAFT,
  })
  status: ProgramTemplateStatus;

  @OneToMany(() => ProgramTemplateSession, (session) => session.program, {
    cascade: true,
  })
  sessions: ProgramTemplateSession[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
