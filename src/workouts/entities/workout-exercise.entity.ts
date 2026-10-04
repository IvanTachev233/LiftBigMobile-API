import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Workout } from './workout.entity';
import { Exercise } from './exercise.entity';
import { WorkoutSet } from './workout-set.entity';

// One exercise card on a workout; a workout can hold several cards using the
// same exercise.
@Entity('workout_exercise')
export class WorkoutExercise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  workoutId: string;

  @ManyToOne(() => Workout, (workout) => workout.exercises, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'workoutId' })
  workout: Workout;

  @Column()
  exerciseId: string;

  @ManyToOne(() => Exercise, { nullable: false })
  @JoinColumn({ name: 'exerciseId' })
  exercise: Exercise;

  // Position of this card among the workout's cards.
  @Column()
  order: number;

  // Cards sharing a value form one superset; null = not part of one.
  @Column({ type: 'uuid', nullable: true })
  supersetGroup: string | null;

  @OneToMany(() => WorkoutSet, (set) => set.workoutExercise, {
    cascade: true,
  })
  sets: WorkoutSet[];
}
