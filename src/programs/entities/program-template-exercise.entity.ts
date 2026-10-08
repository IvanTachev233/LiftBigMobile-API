import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/decimal.transformer';
import { Exercise } from '../../workouts/entities/exercise.entity';
import { ProgramTemplateSession } from './program-template-session.entity';

// An exercise in a template session. Its target weight is percentOf1RM of
// the user's 1RM on referenceExerciseId; both are set or both null.
@Entity('program_template_exercise')
@Check('("percentOf1RM" IS NULL) = ("referenceExerciseId" IS NULL)')
export class ProgramTemplateExercise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => ProgramTemplateSession, (session) => session.exercises, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'sessionId' })
  session: ProgramTemplateSession;

  @Column({ type: 'uuid' })
  exerciseId: string;

  @ManyToOne(() => Exercise, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'exerciseId' })
  exercise: Exercise;

  @Column({ type: 'integer' })
  order: number;

  @Column({ type: 'integer' })
  sets: number;

  @Column({ type: 'integer' })
  reps: number;

  @Column('decimal', {
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  percentOf1RM: number | null;

  @Column({ type: 'uuid', nullable: true })
  referenceExerciseId: string | null;

  @ManyToOne(() => Exercise, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'referenceExerciseId' })
  referenceExercise: Exercise | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
