import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/decimal.transformer';
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

  @Column('decimal', {
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  weight: number | null;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @Column()
  order: number;

  @Column({ type: 'boolean', nullable: true, default: null })
  made: boolean | null;

  // Program exercises sharing the same value form one superset; null = not
  // part of one.
  @Column({ type: 'uuid', nullable: true })
  supersetGroup: string | null;
}
