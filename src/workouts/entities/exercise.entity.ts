import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { WorkoutSet } from './workout-set.entity';

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
export class Exercise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: BodyPart,
    default: BodyPart.OTHER,
  })
  bodyPart: BodyPart;

  @OneToMany(() => WorkoutSet, (set) => set.exercise)
  sets: WorkoutSet[];
}
