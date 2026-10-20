import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface WorkoutView {
  id: string;
  exercises: {
    id: string;
    sets: { id: string; actualReps: number | null }[];
  }[];
}

describe('Reps validation (e2e)', () => {
  let app: INestApplication<App>;
  let squat: Exercise;
  let client: E2eUser;
  let coach: E2eUser;

  const as = (user: E2eUser) => {
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${user.token}`);
    const server = () => request(app.getHttpServer());
    return {
      post: (path: string, body: object) =>
        auth(server().post(path)).send(body),
      patch: (path: string, body: object) =>
        auth(server().patch(path)).send(body),
    };
  };

  const assign = (reps: number | null) =>
    as(coach).post(`/coach/clients/${client.id}/workouts`, {
      name: 'Assigned',
      date: '2026-10-14',
      exercises: [{ exerciseId: squat.id, order: 1, sets: [{ reps }] }],
    });

  const messages = (res: request.Response) =>
    (res.body as { message: string[] }).message;

  beforeAll(async () => {
    app = await createE2eApp();
    const dataSource = app.get(DataSource);
    squat = await dataSource
      .getRepository(Exercise)
      .findOneByOrFail({ name: 'Back Squat' });
    client = await registerAndLogin(app);
    coach = await registerAndLogin(app, 'COACH');
    await dataSource
      .getRepository(User)
      .update({ id: client.id }, { coachId: coach.id });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['0', 0, 'must not be less than 1'],
    ['blank', null, 'must be an integer number'],
  ])(
    '400s a coach workout with %s planned reps, naming the field',
    async (_, reps, text) => {
      const res = await assign(reps).expect(400);
      expect(messages(res)).toContainEqual(
        expect.stringMatching(new RegExp(`sets\\.0\\.reps ${text}`)),
      );
    },
  );

  it('400s a client set added with 0 reps or logged with negative reps, and takes 0 actual reps', async () => {
    const workout = (await assign(5).expect(201)).body as WorkoutView;
    const card = workout.exercises[0];

    const added = await as(client)
      .post(`/workouts/${workout.id}/cards/${card.id}/sets`, { reps: 0 })
      .expect(400);
    expect(messages(added)).toContain('reps must not be less than 1');

    const setPath = `/workouts/${workout.id}/sets/${card.sets[0].id}`;
    const logged = await as(client)
      .patch(setPath, { made: false, actualReps: -1 })
      .expect(400);
    expect(messages(logged)).toContain('actualReps must not be less than 0');

    await as(client).patch(setPath, { made: false, actualReps: 0 }).expect(200);
  });

  it('400s a self-made workout saved with 0 reps', async () => {
    const created = (
      await as(client)
        .post('/workouts', { name: 'Mine', date: '2026-10-14' })
        .expect(201)
    ).body as WorkoutView;

    const res = await as(client)
      .patch(`/workouts/${created.id}`, {
        exercises: [
          {
            exerciseId: squat.id,
            order: 1,
            sets: [{ reps: 0, weight: 100 }],
          },
        ],
      })
      .expect(400);
    expect(messages(res)).toContainEqual(
      expect.stringMatching(/sets\.0\.reps must not be less than 1/),
    );
  });
});
