import { INestApplication, Logger } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource, IsNull } from 'typeorm';
import { RepMaxEntry } from '../src/lifts/entities/rep-max-entry.entity';
import { UserBestLift } from '../src/lifts/entities/user-best-lift.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { WorkoutExercise } from '../src/workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../src/workouts/entities/workout-set.entity';
import {
  Workout,
  WorkoutStatus,
} from '../src/workouts/entities/workout.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

// Logged sets saved before auto-record are backfilled at bootstrap.
describe('Personal best backfill (e2e)', () => {
  let app: INestApplication<App>;
  let squat: Exercise;
  let log: jest.SpyInstance;

  const dataSource = () => app.get(DataSource);

  // A completed workout with one made 1-rep squat set, written straight to
  // the tables so nothing is recorded.
  async function logged(user: E2eUser, date: string, weight: number) {
    const workout = await dataSource()
      .getRepository(Workout)
      .save({
        userId: user.id,
        name: `Logged ${date}`,
        date: new Date(`${date}T00:00:00`),
        status: WorkoutStatus.COMPLETED,
      });
    const card = await dataSource().getRepository(WorkoutExercise).save({
      workoutId: workout.id,
      exerciseId: squat.id,
      order: 1,
    });
    const set = await dataSource().getRepository(WorkoutSet).save({
      workoutExerciseId: card.id,
      reps: 1,
      weight,
      made: true,
      order: 1,
    });
    return set.id;
  }

  const entriesOf = (user: E2eUser) =>
    dataSource()
      .getRepository(RepMaxEntry)
      .find({ where: { userId: user.id }, order: { achievedOn: 'ASC' } });

  const restart = async () => {
    await app.close();
    app = await createE2eApp({ dropSchema: false });
  };

  const backfillLogs = () =>
    log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('personal best'));

  beforeAll(async () => {
    app = await createE2eApp();
    squat = await dataSource()
      .getRepository(Exercise)
      .findOneByOrFail({ name: 'Back Squat' });
  });

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log');
  });

  afterEach(() => {
    log.mockRestore();
    delete process.env.BACKFILL_PBS;
  });

  afterAll(async () => {
    await app.close();
  });

  it('records PBs oldest first once, keeps removed entries removed, and is skipped when disabled', async () => {
    const user = await registerAndLogin(app);
    // Saved newest first; dated 100, then 105, then 102
    await logged(user, '2026-09-03', 102);
    const set105 = await logged(user, '2026-09-02', 105);
    const set100 = await logged(user, '2026-09-01', 100);

    await restart();
    const entries = await entriesOf(user);
    expect(
      entries.map((e) => [e.achievedOn, e.reps, e.weightKg, e.source]),
    ).toEqual([
      ['2026-09-01', 1, 100, 'LOGGED_SET'],
      ['2026-09-02', 1, 105, 'LOGGED_SET'],
    ]);
    expect(entries.map((e) => e.workoutSetId)).toEqual([set100, set105]);
    expect(
      await dataSource()
        .getRepository(UserBestLift)
        .findOneBy({ userId: user.id, exerciseId: squat.id }),
    ).toMatchObject({ weightKg: 105, achievedOn: '2026-09-02' });
    expect(backfillLogs()).toEqual([
      expect.stringMatching(/^Backfilled \d+ personal bests$/),
    ]);

    // A second start adds nothing and logs nothing
    log.mockClear();
    await restart();
    expect(await entriesOf(user)).toHaveLength(2);
    expect(backfillLogs()).toEqual([]);

    // A removed entry stays removed
    await dataSource()
      .getRepository(RepMaxEntry)
      .update({ workoutSetId: set100 }, { removedAt: new Date() });
    await restart();
    const after = await entriesOf(user);
    expect(after).toHaveLength(2);
    expect(
      after.filter((e) => e.removedAt === null).map((e) => e.weightKg),
    ).toEqual([105]);
    expect(
      await dataSource()
        .getRepository(RepMaxEntry)
        .countBy({ workoutSetId: set100, removedAt: IsNull() }),
    ).toBe(0);

    // BACKFILL_PBS=false adds nothing
    const other = await registerAndLogin(app);
    await logged(other, '2026-09-01', 100);
    process.env.BACKFILL_PBS = 'false';
    await restart();
    expect(await entriesOf(other)).toEqual([]);
  });
});
