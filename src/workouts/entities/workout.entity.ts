import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/decimal.transformer';
import { User } from '../../auth/user.entity';
import { WorkoutExercise } from './workout-exercise.entity';

export enum WorkoutStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

@Entity()
export class Workout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.workouts)
  user: User;

  @Column()
  userId: string;

  // The coach who assigned this workout; null for a self-made one.
  @Column({ type: 'uuid', nullable: true })
  assignedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignedById' })
  assignedBy: User | null;

  @Column()
  date: Date;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @Column({ default: false })
  isTemplate: boolean;

  @Column('decimal', { default: 0, transformer: decimalTransformer })
  totalWeightLifted: number;

  @Column({
    type: 'enum',
    enum: WorkoutStatus,
    default: WorkoutStatus.PLANNED,
  })
  status: WorkoutStatus;

  @OneToMany(() => WorkoutExercise, (exercise) => exercise.workout, {
    cascade: true,
  })
  exercises: WorkoutExercise[];
}
