import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Workout } from './workout.entity';
import { Exercise } from './exercise.entity';

export enum WeightMode {
  EXACT = 'EX',
  PERCENTAGE = 'PC',
  RPE = 'RP',
}

@Entity()
export class WorkoutSet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Workout, (workout) => workout.sets, { onDelete: 'CASCADE' })
  workout: Workout;

  @Column()
  workoutId: string;

  @ManyToOne(() => Exercise, (exercise) => exercise.sets)
  exercise: Exercise;

  @Column()
  exerciseId: string;

  @Column()
  reps: number;

  @Column('decimal', { precision: 5, scale: 2 })
  weight: number;

  @Column({
    type: 'enum',
    enum: WeightMode,
    default: WeightMode.EXACT,
  })
  weightMode: WeightMode;

  @Column('decimal', { nullable: true })
  expectedWeight: number;

  @Column({ nullable: true })
  actualReps: number;

  @Column('decimal', { nullable: true })
  actualWeight: number;

  @Column({ default: false })
  isCompleted: boolean;

  @Column()
  order: number;
}
