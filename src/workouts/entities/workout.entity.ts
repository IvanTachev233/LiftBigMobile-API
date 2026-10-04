import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
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

  @Column()
  date: Date;

  @Column()
  name: string;

  @Column({ nullable: true })
  notes: string;

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
