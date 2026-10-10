import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../auth/user.entity';
import { decimalTransformer } from '../../common/decimal.transformer';
import { WeightUnit } from '../../common/weight-unit';
import { Exercise } from '../../workouts/entities/exercise.entity';
import { LiftRecordSource } from './lift-record-source';

// A user's heaviest 1RM on an exercise. unit is the unit it was entered in.
@Entity('user_best_lift')
@Unique(['userId', 'exerciseId'])
export class UserBestLift {
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
}
