import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/decimal.transformer';
import { WorkoutExercise } from './workout-exercise.entity';

export enum WeightMode {
  EXACT = 'EX',
  PERCENTAGE = 'PC',
  RPE = 'RP',
}

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

  @Column()
  reps: number;

  @Column('decimal', {
    precision: 5,
    scale: 2,
    transformer: decimalTransformer,
  })
  weight: number;

  @Column({
    type: 'enum',
    enum: WeightMode,
    default: WeightMode.EXACT,
  })
  weightMode: WeightMode;

  @Column('decimal', { nullable: true, transformer: decimalTransformer })
  expectedWeight: number;

  @Column({ nullable: true })
  actualReps: number;

  @Column('decimal', { nullable: true, transformer: decimalTransformer })
  actualWeight: number;

  @Column({ default: false })
  isCompleted: boolean;

  // Set number inside its card.
  @Column()
  order: number;
}
