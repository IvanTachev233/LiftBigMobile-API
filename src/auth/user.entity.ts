import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Workout } from '../workouts/entities/workout.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ default: 'CLIENT' })
  role: 'COACH' | 'CLIENT';

  @Column({ nullable: true })
  coachId: string | null;

  @ManyToOne(() => User, (user) => user.clients, { nullable: true })
  @JoinColumn({ name: 'coachId' })
  coach: User;

  @OneToMany(() => User, (user) => user.coach)
  clients: User[];

  @OneToMany(() => Workout, (workout) => workout.user)
  workouts: Workout[];
}
