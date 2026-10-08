import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ProgramTemplateExercise } from './program-template-exercise.entity';
import { ProgramTemplate } from './program-template.entity';

// A session of a template. It falls dayOffset days after the start of its
// week.
@Entity('program_template_session')
@Unique(['programId', 'week', 'sessionIndex'])
export class ProgramTemplateSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  programId: string;

  @ManyToOne(() => ProgramTemplate, (program) => program.sessions, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'programId' })
  program: ProgramTemplate;

  @Column({ type: 'integer' })
  week: number;

  @Column({ type: 'integer' })
  sessionIndex: number;

  @Column({ type: 'integer' })
  dayOffset: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => ProgramTemplateExercise, (exercise) => exercise.session, {
    cascade: true,
  })
  exercises: ProgramTemplateExercise[];
}
