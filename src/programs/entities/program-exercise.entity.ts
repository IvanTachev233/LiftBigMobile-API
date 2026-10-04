import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Program } from './program.entity';
import { Exercise } from '../../workouts/entities/exercise.entity';
import { ProgramSet } from './program-set.entity';

// One exercise card on a program; a program can hold several cards using the
// same exercise.
@Entity('program_exercise')
export class ProgramExercise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  programId: string;

  @ManyToOne(() => Program, (p) => p.exercises, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'programId' })
  program: Program;

  @Column()
  exerciseId: string;

  @ManyToOne(() => Exercise, { nullable: false })
  @JoinColumn({ name: 'exerciseId' })
  exercise: Exercise;

  // Position of this card among the program's cards.
  @Column()
  order: number;

  // Cards sharing the same value form one superset; null = not part of one.
  @Column({ type: 'uuid', nullable: true })
  supersetGroup: string | null;

  @OneToMany(() => ProgramSet, (set) => set.programExercise, {
    cascade: true,
  })
  sets: ProgramSet[];
}
