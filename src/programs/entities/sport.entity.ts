import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SportRequiredLift } from './sport-required-lift.entity';

// One tab on the Premade Programs page, sorted by displayOrder.
@Entity('sport')
export class Sport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'integer', default: 0 })
  displayOrder: number;

  @OneToMany(() => SportRequiredLift, (lift) => lift.sport)
  requiredLifts: SportRequiredLift[];
}
