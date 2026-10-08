import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/decimal.transformer';
import { Exercise } from './exercise.entity';
import { WorkoutExercise } from './workout-exercise.entity';

@Entity()
export class WorkoutSet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  workoutExerciseId: string;

  @ManyToOne(() => WorkoutExercise, (workoutExercise) => workoutExercise.sets, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'workoutExerciseId' })
  workoutExercise: WorkoutExercise;

  // Planned reps and weight.
  @Column()
  reps: number;

  @Column('decimal', {
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  weight: number | null;

  // For program sets: the planned weight is prescribedPercent of the user's
  // 1RM on referenceExerciseId.
  @Column('decimal', {
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  prescribedPercent: number | null;

  @Column({ type: 'uuid', nullable: true })
  referenceExerciseId: string | null;

  @ManyToOne(() => Exercise, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'referenceExerciseId' })
  referenceExercise: Exercise | null;

  // Logged values; null means "as planned" once the set is logged.
  @Column({ type: 'integer', nullable: true })
  actualReps: number | null;

  @Column('decimal', {
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  actualWeight: number | null;

  // true = made, false = missed, null = not logged.
  @Column({ type: 'boolean', nullable: true, default: null })
  made: boolean | null;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  // Set number inside its card.
  @Column()
  order: number;
}
