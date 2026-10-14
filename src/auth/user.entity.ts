import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DEFAULT_REST_SECONDS } from '../common/rest-seconds';
import { WeightUnit } from '../common/weight-unit';
import { Workout } from '../workouts/entities/workout.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ select: false })
  passwordHash: string;

  @Column({ default: 'CLIENT' })
  role: 'COACH' | 'CLIENT';

  @Column({ type: 'enum', enum: WeightUnit, default: WeightUnit.KG })
  weightUnit: WeightUnit;

  // Default rest between sets in the logger, in seconds
  @Column({ type: 'int', default: DEFAULT_REST_SECONDS })
  restSeconds: number;

  // Signed into access tokens; raising it revokes every earlier token
  @Column({ type: 'int', default: 0, select: false })
  tokenVersion: number;

  // Wrong current passwords on Change password since the last success or lock
  @Column({ type: 'int', default: 0, select: false })
  failedPasswordAttempts: number;

  @Column({ type: 'timestamp', nullable: true, select: false })
  passwordLockedUntil: Date | null;

  // When the user entered a code mailed to this address; null until then
  @Column({ type: 'timestamp', nullable: true })
  emailVerifiedAt: Date | null;

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
