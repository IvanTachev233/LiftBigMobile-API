import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/user.entity';
import { ProgramExercise } from './program-exercise.entity';

@Entity()
export class Program {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  clientId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'clientId' })
  client: User;

  @Column()
  coachId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'coachId' })
  coach: User;

  @Column()
  name: string;

  @Column({ type: 'date' })
  scheduledDate: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ProgramExercise, (pe) => pe.program, { cascade: true })
  exercises: ProgramExercise[];
}
