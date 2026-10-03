import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { WorkoutSet } from './workout-set.entity';
import { User } from '../../auth/user.entity';

export enum BodyPart {
  CHEST = 'CH',
  BACK = 'BK',
  LEGS = 'LG',
  SHOULDERS = 'SH',
  ARMS = 'AR',
  CORE = 'CO',
  FULL_BODY = 'FB',
  OTHER = 'OT',
}

@Entity()
// Names are unique per owner. Postgres treats null owners as distinct, so
// duplicate global names are blocked by the service's 409 check instead.
@Unique(['name', 'createdById'])
export class Exercise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: BodyPart,
    default: BodyPart.OTHER,
  })
  bodyPart: BodyPart;

  // null = global, visible to everyone. Otherwise the coach who created it,
  // visible to that coach and their clients. A coach who owns exercises
  // can't be deleted.
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  @Column({ type: 'varchar', nullable: true })
  videoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  imageUrl: string | null;

  @OneToMany(() => WorkoutSet, (set) => set.exercise)
  sets: WorkoutSet[];
}
