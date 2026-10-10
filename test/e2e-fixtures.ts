import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { User } from '../src/auth/user.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { Sport } from '../src/programs/entities/sport.entity';
import { SportRequiredLift } from '../src/programs/entities/sport-required-lift.entity';

// A sport with uniquely named global exercises, the first `required` of
// them being its required lifts.
export async function createSportWithExercises(
  dataSource: DataSource,
  names: string[],
  required: number,
): Promise<{ sport: Sport; exercises: Record<string, Exercise> }> {
  const suffix = randomUUID().slice(0, 8);
  const sport = await dataSource
    .getRepository(Sport)
    .save({ name: `Test Sport ${suffix}`, displayOrder: 99 });
  const exercises: Record<string, Exercise> = {};
  for (const [i, name] of names.entries()) {
    exercises[name] = await dataSource.getRepository(Exercise).save({
      name: `${name} ${suffix}`,
      createdById: null,
      isMaxTrackable: i < required,
    });
    if (i < required) {
      await dataSource.getRepository(SportRequiredLift).save({
        sportId: sport.id,
        exerciseId: exercises[name].id,
        label: name,
        displayOrder: i,
      });
    }
  }
  return { sport, exercises };
}

export function findUser(dataSource: DataSource, id: string): Promise<User> {
  return dataSource.getRepository(User).findOneByOrFail({ id });
}
