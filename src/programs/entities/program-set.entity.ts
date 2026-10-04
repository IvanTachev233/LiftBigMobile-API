import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/decimal.transformer';
import { ProgramExercise } from './program-exercise.entity';

// One set row inside a program exercise card.
@Entity('program_set')
export class ProgramSet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  programExerciseId: string;

  @ManyToOne(() => ProgramExercise, (programExercise) => programExercise.sets, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'programExerciseId' })
  programExercise: ProgramExercise;

  @Column()
  reps: number;

  @Column('decimal', {
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  weight: number | null;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  // Set number inside its card.
  @Column()
  order: number;

  @Column({ type: 'boolean', nullable: true, default: null })
  made: boolean | null;
}
