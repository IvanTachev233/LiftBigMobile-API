import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Program } from './program.entity';
import { Exercise } from '../../workouts/entities/exercise.entity';

@Entity()
export class ProgramExercise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  programId: string;

  @ManyToOne(() => Program, (p) => p.exercises, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programId' })
  program: Program;

  @Column()
  exerciseId: string;

  @ManyToOne(() => Exercise)
  @JoinColumn({ name: 'exerciseId' })
  exercise: Exercise;

  @Column()
  reps: number;

  @Column('decimal', { precision: 6, scale: 2, nullable: true })
  weight: number;

  @Column({ nullable: true })
  notes: string;

  @Column()
  order: number;
}
