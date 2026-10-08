import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/user.entity';
import { decimalTransformer } from '../../common/decimal.transformer';
import { WeightUnit } from '../../common/weight-unit';
import { Exercise } from '../../workouts/entities/exercise.entity';
import { WorkoutSet } from '../../workouts/entities/workout-set.entity';
import { LiftRecordSource } from './lift-record-source';

// One recorded rep max. Rows are only ever appended. workoutSetId is the
// logged set it came from, if any; a set is recorded at most once.
@Entity('rep_max_entry')
@Check('"reps" >= 1')
export class RepMaxEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  exerciseId: string;

  @ManyToOne(() => Exercise, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'exerciseId' })
  exercise: Exercise;

  @Column({ type: 'integer' })
  reps: number;

  @Column('decimal', {
    precision: 6,
    scale: 2,
    transformer: decimalTransformer,
  })
  weightKg: number;

  @Column({ type: 'enum', enum: WeightUnit, default: WeightUnit.KG })
  unit: WeightUnit;

  @Column({ type: 'date' })
  achievedOn: string;

  @Column({ type: 'enum', enum: LiftRecordSource })
  source: LiftRecordSource;

  @Column({ type: 'uuid', nullable: true, unique: true })
  workoutSetId: string | null;

  @ManyToOne(() => WorkoutSet, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'workoutSetId' })
  workoutSet: WorkoutSet | null;

  @CreateDateColumn()
  createdAt: Date;
}
