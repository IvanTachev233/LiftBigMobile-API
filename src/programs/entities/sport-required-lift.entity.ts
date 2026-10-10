import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Exercise } from '../../workouts/entities/exercise.entity';
import { Sport } from './sport.entity';

// A lift a sport tracks maxes for. label is the sport's own name for the
// exercise (e.g. "Squat" for Back Squat).
@Entity('sport_required_lift')
@Unique(['sportId', 'exerciseId'])
export class SportRequiredLift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sportId: string;

  @ManyToOne(() => Sport, (sport) => sport.requiredLifts, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'sportId' })
  sport: Sport;

  @Column({ type: 'uuid' })
  exerciseId: string;

  @ManyToOne(() => Exercise, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'exerciseId' })
  exercise: Exercise;

  @Column()
  label: string;

  @Column({ type: 'integer', default: 0 })
  displayOrder: number;
}
