import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { RepMaxEntry } from '../src/lifts/entities/rep-max-entry.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { WorkoutExercise } from '../src/workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../src/workouts/entities/workout-set.entity';
import { Workout } from '../src/workouts/entities/workout.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface BestView {
  exerciseId: string;
  weightKg: number;
  achievedOn: string;
  source: string;
}

interface EntryView {
  id: string;
  reps: number;
  weightKg: number;
  achievedOn: string;
  source: string;
  workoutSetId: string | null;
}

interface History {
  exerciseId: string;
  best: BestView | null;
  latest: { reps: number; entry: EntryView | null }[];
  entries: EntryView[];
}

describe('Lifts (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let squat: Exercise;
  let row: Exercise;
  let client: E2eUser;

  const as = (user: E2eUser) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${user.token}`),
    post: (path: string, body?: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body),
  });

  const manual = (
    user: E2eUser,
    reps: number,
    weightKg: number,
    achievedOn = '2026-10-01',
    exerciseId = squat.id,
  ) =>
    as(user).post('/lifts/rep-maxes', {
      exerciseId,
      reps,
      weightKg,
      achievedOn,
    });

  const best = async (user: E2eUser) =>
    (
      (await as(user).get(`/lifts/best?exerciseIds=${squat.id}`).expect(200))
        .body as BestView[]
    )[0];

  // One logged set on a workout of the user; returns the set id.
  async function loggedSet(
    user: E2eUser,
    exercise: Exercise,
    set: Partial<WorkoutSet>,
  ): Promise<{ setId: string; workoutId: string }> {
    const workout = await dataSource.getRepository(Workout).save({
      userId: user.id,
      name: 'Logged',
      date: new Date('2026-10-05'),
    });
    const card = await dataSource.getRepository(WorkoutExercise).save({
      workoutId: workout.id,
      exerciseId: exercise.id,
      order: 1,
    });
    const saved = await dataSource.getRepository(WorkoutSet).save({
      workoutExerciseId: card.id,
      reps: 3,
      weight: 100,
      made: true,
      order: 1,
      ...set,
    });
    return { setId: saved.id, workoutId: workout.id };
  }

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    squat = await dataSource
      .getRepository(Exercise)
      .findOneByOrFail({ name: 'Back Squat' });
    row = await dataSource
      .getRepository(Exercise)
      .findOneByOrFail({ name: 'Barbell Row' });
  });

  beforeEach(async () => {
    client = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('needs a login', async () => {
    await request(app.getHttpServer()).get('/lifts/best').expect(401);
  });

  it('only raises the best', async () => {
    await manual(client, 1, 100, '2026-09-01').expect(201);
    expect(await best(client)).toMatchObject({
      weightKg: 100,
      achievedOn: '2026-09-01',
      source: 'MANUAL',
    });

    await manual(client, 1, 90).expect(201);
    await manual(client, 3, 150).expect(201);
    expect((await best(client)).weightKg).toBe(100);

    await manual(client, 1, 105, '2026-10-02').expect(201);
    expect(await best(client)).toMatchObject({
      weightKg: 105,
      achievedOn: '2026-10-02',
    });
  });

  it('returns the latest 1/2/3RM and every entry in the history', async () => {
    await manual(client, 1, 100, '2026-09-01').expect(201);
    await manual(client, 1, 95, '2026-09-20').expect(201);
    await manual(client, 3, 90, '2026-09-10').expect(201);

    const history = (
      await as(client).get(`/lifts/${squat.id}/history`).expect(200)
    ).body as History;
    expect(history.best?.weightKg).toBe(100);
    expect(
      history.latest.map((l) => [l.reps, l.entry?.weightKg ?? null]),
    ).toEqual([
      [1, 95],
      [2, null],
      [3, 90],
    ]);
    expect(history.entries.map((e) => e.achievedOn)).toEqual([
      '2026-09-01',
      '2026-09-10',
      '2026-09-20',
    ]);

    const other = await registerAndLogin(app);
    const empty = (
      await as(other).get(`/lifts/${squat.id}/history`).expect(200)
    ).body as History;
    expect(empty).toMatchObject({ best: null, entries: [] });
  });

  it('validates manual entries', async () => {
    await manual(client, 4, 100).expect(400);
    await manual(client, 0, 100).expect(400);
    await manual(client, 1, 0).expect(400);
    await manual(client, 1, 100, '2026-13-01').expect(400);
    await manual(client, 1, 100, '2999-01-01').expect(400);
    await manual(
      client,
      1,
      100,
      '2026-10-01',
      '00000000-0000-4000-8000-000000000000',
    ).expect(400);
  });

  it('records a made logged set once, as LOGGED_SET on the workout date', async () => {
    const { setId } = await loggedSet(client, squat, {
      reps: 5,
      actualReps: 2,
      weight: 100,
      actualWeight: 110,
    });
    const recorded = await as(client)
      .post(`/lifts/rep-maxes/from-set/${setId}`)
      .expect(201);
    expect((recorded.body as { entry: EntryView }).entry).toMatchObject({
      reps: 2,
      weightKg: 110,
      achievedOn: '2026-10-05',
      source: 'LOGGED_SET',
      workoutSetId: setId,
    });
    await as(client).post(`/lifts/rep-maxes/from-set/${setId}`).expect(409);
  });

  it('rejects sets that cannot be rep maxes', async () => {
    const unmade = await loggedSet(client, squat, { made: false });
    const unlogged = await loggedSet(client, squat, { made: null });
    const fourReps = await loggedSet(client, squat, { reps: 4 });
    const notTrackable = await loggedSet(client, row, { reps: 3 });
    for (const { setId } of [unmade, unlogged, fourReps, notTrackable]) {
      await as(client).post(`/lifts/rep-maxes/from-set/${setId}`).expect(400);
    }
  });

  it("404s on another user's set", async () => {
    const other = await registerAndLogin(app);
    const { setId } = await loggedSet(other, squat, {});
    await as(client).post(`/lifts/rep-maxes/from-set/${setId}`).expect(404);
  });

  it('keeps the entry when its workout is deleted', async () => {
    const { setId, workoutId } = await loggedSet(client, squat, { reps: 1 });
    const recorded = await as(client)
      .post(`/lifts/rep-maxes/from-set/${setId}`)
      .expect(201);
    const { id } = (recorded.body as { entry: EntryView }).entry;

    await request(app.getHttpServer())
      .delete(`/workouts/${workoutId}`)
      .set('Authorization', `Bearer ${client.token}`)
      .expect(200);

    const entry = await dataSource
      .getRepository(RepMaxEntry)
      .findOneByOrFail({ id });
    expect(entry.workoutSetId).toBeNull();
    expect((await best(client)).weightKg).toBe(100);
  });

  it('has no update or delete routes for entries', async () => {
    await manual(client, 1, 100).expect(201);
    const [entry] = (
      (await as(client).get(`/lifts/${squat.id}/history`).expect(200))
        .body as History
    ).entries;
    const server = app.getHttpServer();
    const auth = `Bearer ${client.token}`;
    await request(server)
      .patch(`/lifts/rep-maxes/${entry.id}`)
      .set('Authorization', auth)
      .send({ weightKg: 1 })
      .expect(404);
    await request(server)
      .delete(`/lifts/rep-maxes/${entry.id}`)
      .set('Authorization', auth)
      .expect(404);
  });
});
