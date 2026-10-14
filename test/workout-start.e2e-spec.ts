import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import {
  Workout,
  WorkoutStatus,
} from '../src/workouts/entities/workout.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface WorkoutView {
  id: string;
  status: string;
  startedAt: string | null;
  exercises: { id: string; sets: { id: string }[] }[];
}

interface SetResponse {
  id: string;
  workoutStartedAt: string | null;
}

describe('Workout start time (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let squat: Exercise;
  let client: E2eUser;
  let coach: E2eUser;

  const as = (user: E2eUser) => {
    const server = () => request(app.getHttpServer());
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${user.token}`);
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string, body: object) =>
        auth(server().post(path)).send(body),
      patch: (path: string, body: object) =>
        auth(server().patch(path)).send(body),
      put: (path: string, body: object) => auth(server().put(path)).send(body),
    };
  };

  const view = async (id: string, user = client) =>
    (await as(user).get(`/workouts/${id}`).expect(200)).body as WorkoutView;

  const manualWorkout = async () =>
    (
      await as(client)
        .post('/workouts', { name: 'Manual', date: '2026-10-14' })
        .expect(201)
    ).body as WorkoutView;

  const assignedWorkout = async () =>
    (
      await as(coach)
        .post(`/coach/clients/${client.id}/workouts`, {
          name: 'Assigned',
          date: '2026-10-14',
          exercises: [
            {
              exerciseId: squat.id,
              order: 1,
              sets: [
                { reps: 5, weight: 100 },
                { reps: 5, weight: 100 },
              ],
            },
          ],
        })
        .expect(201)
    ).body as WorkoutView;

  const logSet = async (workout: WorkoutView, n: number, made = true) =>
    (
      await as(client)
        .patch(
          `/workouts/${workout.id}/sets/${workout.exercises[0].sets[n].id}`,
          {
            made,
          },
        )
        .expect(200)
    ).body as SetResponse;

  // A time the server set during [before, after]
  const expectBetween = (
    value: string | null,
    before: number,
    after: number,
  ) => {
    expect(value).not.toBeNull();
    const at = new Date(value!).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(after + 1000);
  };

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    squat = await dataSource
      .getRepository(Exercise)
      .findOneByOrFail({ name: 'Back Squat' });
  });

  beforeEach(async () => {
    client = await registerAndLogin(app);
    coach = await registerAndLogin(app, 'COACH');
    await dataSource
      .getRepository(User)
      .update({ id: client.id }, { coachId: coach.id });
  });

  afterAll(async () => {
    await app.close();
  });

  it('is null until the workout leaves PLANNED', async () => {
    const manual = await manualWorkout();
    expect(manual.startedAt).toBeNull();
    const assigned = await assignedWorkout();
    expect(assigned.startedAt).toBeNull();
    expect((await view(assigned.id)).startedAt).toBeNull();
  });

  it('is set once by the first logged set and kept by later sets and completing', async () => {
    const workout = await assignedWorkout();

    const before = Date.now();
    const first = await logSet(workout, 0);
    const after = Date.now();
    expectBetween(first.workoutStartedAt, before, after);
    const started = (await view(workout.id)).startedAt;
    expect(started).toBe(first.workoutStartedAt);

    const second = await logSet(workout, 1, false);
    expect(second.workoutStartedAt).toBe(started);
    await as(client)
      .patch(`/workouts/${workout.id}`, { status: 'COMPLETED' })
      .expect(200);
    const completed = await view(workout.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.startedAt).toBe(started);

    // Reopening and finishing again keeps the first start
    await as(client)
      .patch(`/workouts/${workout.id}`, { status: 'PLANNED' })
      .expect(200);
    await logSet(workout, 0);
    expect((await view(workout.id)).startedAt).toBe(started);

    const coachView = (
      await as(coach).get(`/coach/workouts/${workout.id}`).expect(200)
    ).body as WorkoutView;
    expect(coachView.startedAt).toBe(started);
  });

  it('is set by an added set with a result, not by one without', async () => {
    const workout = await assignedWorkout();
    const path = `/workouts/${workout.id}/cards/${workout.exercises[0].id}/sets`;

    const unlogged = (
      await as(client).post(path, { reps: 3, weight: 60 }).expect(201)
    ).body as SetResponse;
    expect(unlogged.workoutStartedAt).toBeNull();
    expect((await view(workout.id)).status).toBe('PLANNED');

    const before = Date.now();
    const logged = (
      await as(client)
        .post(path, { reps: 3, weight: 60, made: true })
        .expect(201)
    ).body as SetResponse;
    expectBetween(logged.workoutStartedAt, before, Date.now());
  });

  it('is set when a manual workout is saved as started or completed', async () => {
    const started = await manualWorkout();
    const before = Date.now();
    const saved = (
      await as(client)
        .patch(`/workouts/${started.id}`, {
          status: 'IN_PROGRESS',
          exercises: [
            {
              exerciseId: squat.id,
              order: 1,
              sets: [{ reps: 5, weight: 100, made: true }],
            },
          ],
        })
        .expect(200)
    ).body as WorkoutView;
    expectBetween(saved.startedAt, before, Date.now());

    const renamed = (
      await as(client)
        .patch(`/workouts/${started.id}`, { name: 'Renamed' })
        .expect(200)
    ).body as WorkoutView;
    expect(renamed.startedAt).toBe(saved.startedAt);

    const completed = await manualWorkout();
    const done = (
      await as(client)
        .patch(`/workouts/${completed.id}`, { status: 'COMPLETED' })
        .expect(200)
    ).body as WorkoutView;
    expect(done.startedAt).not.toBeNull();
  });

  it('stays null on a row that was already started before it existed', async () => {
    const workout = await assignedWorkout();
    await dataSource
      .getRepository(Workout)
      .update(
        { id: workout.id },
        { status: WorkoutStatus.IN_PROGRESS, startedAt: null },
      );

    expect((await logSet(workout, 0)).workoutStartedAt).toBeNull();
    await as(client)
      .patch(`/workouts/${workout.id}`, { status: 'COMPLETED' })
      .expect(200);
    expect((await view(workout.id)).startedAt).toBeNull();
  });

  it("can't be written by the client or the coach", async () => {
    const manual = await manualWorkout();
    await as(client)
      .patch(`/workouts/${manual.id}`, {
        name: 'Manual',
        startedAt: '2020-01-01T00:00:00.000Z',
      })
      .expect(200);
    expect((await view(manual.id)).startedAt).toBeNull();

    const assigned = await assignedWorkout();
    await as(coach)
      .put(`/coach/workouts/${assigned.id}`, {
        name: 'Assigned',
        startedAt: '2020-01-01T00:00:00.000Z',
      })
      .expect(200);
    expect((await view(assigned.id)).startedAt).toBeNull();
  });
});
