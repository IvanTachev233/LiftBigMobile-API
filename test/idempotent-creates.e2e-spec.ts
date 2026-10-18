import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { Workout } from '../src/workouts/entities/workout.entity';
import { WorkoutExercise } from '../src/workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../src/workouts/entities/workout-set.entity';
import { createE2eApp, createExistingUser, E2eUser } from './e2e-app';

interface WorkoutView {
  id: string;
  name: string;
  userId: string;
  exercises: { id: string; sets: { id: string; reps: number }[] }[];
}

// Client ids let the app replay a create after a lost response without
// creating a second row (spec § LB-31 Saving while offline).
describe('Idempotent creates (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let squat: Exercise;
  let bench: Exercise;
  let alice: E2eUser;
  let bob: E2eUser;

  const as = (user: E2eUser) => {
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${user.token}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string, body: object) =>
        auth(server().post(path)).send(body),
      patch: (path: string, body: object) =>
        auth(server().patch(path)).send(body),
    };
  };

  const workoutRows = (id: string) =>
    dataSource.getRepository(Workout).countBy({ id });
  const setRows = (cardId: string) =>
    dataSource.getRepository(WorkoutSet).countBy({ workoutExerciseId: cardId });

  // A self-made workout of `user` with one squat card of one set
  const workoutWithCard = async (user: E2eUser) => {
    const created = await as(user)
      .post('/workouts', { name: 'Legs', date: '2026-10-17' })
      .expect(201);
    const { id } = created.body as WorkoutView;
    const patched = await as(user)
      .patch(`/workouts/${id}`, {
        exercises: [
          { exerciseId: squat.id, order: 1, sets: [{ reps: 5, weight: 100 }] },
        ],
      })
      .expect(200);
    return patched.body as WorkoutView;
  };

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    squat = await dataSource
      .getRepository(Exercise)
      .findOneByOrFail({ name: 'Back Squat' });
    bench = await dataSource
      .getRepository(Exercise)
      .findOneByOrFail({ name: 'Bench Press' });
  });

  beforeEach(async () => {
    alice = await createExistingUser(app);
    bob = await createExistingUser(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /workouts with a client id', () => {
    it('creates once; the replay answers 200 with an equal body', async () => {
      const id = randomUUID();
      const body = { id, name: 'Push', date: '2026-10-17' };

      const first = await as(alice).post('/workouts', body).expect(200);
      const replay = await as(alice).post('/workouts', body).expect(200);

      expect(first.body).toMatchObject({
        id,
        name: 'Push',
        userId: alice.id,
        exercises: [],
      });
      expect(replay.body).toEqual(first.body);
      expect(await workoutRows(id)).toBe(1);
    });

    it('a replay with another body changes nothing and returns the stored row', async () => {
      const id = randomUUID();
      await as(alice)
        .post('/workouts', { id, name: 'Push', date: '2026-10-17' })
        .expect(200);

      const replay = await as(alice)
        .post('/workouts', { id, name: 'Renamed', date: '2026-10-18' })
        .expect(200);

      expect(replay.body).toMatchObject({ id, name: 'Push' });
      expect(await workoutRows(id)).toBe(1);
    });

    it('a replay after cards were saved returns the workout with its cards', async () => {
      const id = randomUUID();
      const body = { id, name: 'Push', date: '2026-10-17' };
      await as(alice).post('/workouts', body).expect(200);
      await as(alice)
        .patch(`/workouts/${id}`, {
          exercises: [
            {
              exerciseId: bench.id,
              order: 1,
              sets: [{ reps: 5, weight: null }],
            },
          ],
        })
        .expect(200);

      const replay = await as(alice).post('/workouts', body).expect(200);

      expect((replay.body as WorkoutView).exercises).toHaveLength(1);
      expect(await workoutRows(id)).toBe(1);
    });

    it("409s on another user's workout id and leaves it untouched", async () => {
      const id = randomUUID();
      await as(alice)
        .post('/workouts', { id, name: 'Push', date: '2026-10-17' })
        .expect(200);

      await as(bob)
        .post('/workouts', { id, name: 'Mine now', date: '2026-10-17' })
        .expect(409);

      const stored = await dataSource
        .getRepository(Workout)
        .findOneByOrFail({ id });
      expect(stored).toMatchObject({ userId: alice.id, name: 'Push' });
      await as(bob).get(`/workouts/${id}`).expect(404);
    });

    it('400s an id that is not a UUID', async () => {
      await as(alice)
        .post('/workouts', { id: 'w-1', name: 'Push', date: '2026-10-17' })
        .expect(400);
    });

    it('without an id still answers 201 with a new UUID each time', async () => {
      const body = { name: 'Push', date: '2026-10-17' };
      const first = await as(alice).post('/workouts', body).expect(201);
      const second = await as(alice).post('/workouts', body).expect(201);

      const ids = [first.body, second.body].map((w) => (w as WorkoutView).id);
      expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(ids[1]).not.toBe(ids[0]);
    });
  });

  describe('POST /workouts/:id/cards/:cardId/sets with a client id', () => {
    it('adds the set once; the replay answers 200 with an equal body', async () => {
      const workout = await workoutWithCard(alice);
      const card = workout.exercises[0];
      const id = randomUUID();
      const url = `/workouts/${workout.id}/cards/${card.id}/sets`;

      const first = await as(alice)
        .post(url, { id, reps: 3, weight: 110, made: true })
        .expect(200);
      const replay = await as(alice)
        .post(url, { id, reps: 3, weight: 110, made: true })
        .expect(200);

      expect(first.body).toMatchObject({
        id,
        workoutExerciseId: card.id,
        reps: 3,
        order: 2,
      });
      expect(replay.body).toEqual(first.body);
      expect(await setRows(card.id)).toBe(2);
    });

    it("409s on another user's set id and adds nothing", async () => {
      const theirs = await workoutWithCard(alice);
      const mine = await workoutWithCard(bob);
      const theirSet = theirs.exercises[0].sets[0].id;
      const myCard = mine.exercises[0].id;

      await as(bob)
        .post(`/workouts/${mine.id}/cards/${myCard}/sets`, {
          id: theirSet,
          reps: 1,
        })
        .expect(409);

      expect(await setRows(myCard)).toBe(1);
      const stored = await dataSource
        .getRepository(WorkoutSet)
        .findOneByOrFail({ id: theirSet });
      expect(stored).toMatchObject({ reps: 5 });
    });

    it('409s on an id of a set on another card', async () => {
      const workout = await workoutWithCard(alice);
      const other = await workoutWithCard(alice);
      const usedId = other.exercises[0].sets[0].id;
      const card = workout.exercises[0];

      await as(alice)
        .post(`/workouts/${workout.id}/cards/${card.id}/sets`, {
          id: usedId,
          reps: 1,
        })
        .expect(409);
      expect(await setRows(card.id)).toBe(1);
    });

    it('without an id still answers 201 and adds a set each time', async () => {
      const workout = await workoutWithCard(alice);
      const card = workout.exercises[0];
      const url = `/workouts/${workout.id}/cards/${card.id}/sets`;

      const first = await as(alice).post(url, { reps: 3 }).expect(201);
      const second = await as(alice).post(url, { reps: 3 }).expect(201);

      expect((second.body as { id: string }).id).not.toBe(
        (first.body as { id: string }).id,
      );
      expect(await setRows(card.id)).toBe(3);
    });
  });

  describe('PATCH /workouts/:id with client ids for new cards and sets', () => {
    const cardRows = (workoutId: string) =>
      dataSource.getRepository(WorkoutExercise).countBy({ workoutId });

    const newCardBody = (cardId: string, setIds: string[]) => ({
      exercises: [
        {
          id: cardId,
          exerciseId: squat.id,
          order: 1,
          sets: setIds.map((id) => ({ id, reps: 5, weight: 100 })),
        },
      ],
    });

    it('creates the rows under the client ids; the same PATCH again changes nothing', async () => {
      const { id: workoutId } = (
        await as(alice)
          .post('/workouts', { name: 'Legs', date: '2026-10-17' })
          .expect(201)
      ).body as WorkoutView;
      const cardId = randomUUID();
      const setIds = [randomUUID(), randomUUID()];
      const body = newCardBody(cardId, setIds);

      const first = await as(alice)
        .patch(`/workouts/${workoutId}`, body)
        .expect(200);
      const replay = await as(alice)
        .patch(`/workouts/${workoutId}`, body)
        .expect(200);

      const ids = (view: WorkoutView) =>
        view.exercises.map((card) => [card.id, card.sets.map((s) => s.id)]);
      expect(ids(first.body as WorkoutView)).toEqual([[cardId, setIds]]);
      expect(ids(replay.body as WorkoutView)).toEqual([[cardId, setIds]]);
      expect(await cardRows(workoutId)).toBe(1);
      expect(await setRows(cardId)).toBe(2);
    });

    it('later writes can use the client card and set ids', async () => {
      const { id: workoutId } = (
        await as(alice)
          .post('/workouts', { name: 'Legs', date: '2026-10-17' })
          .expect(201)
      ).body as WorkoutView;
      const cardId = randomUUID();
      const setId = randomUUID();
      await as(alice)
        .patch(`/workouts/${workoutId}`, newCardBody(cardId, [setId]))
        .expect(200);

      await as(alice)
        .patch(`/workouts/${workoutId}/sets/${setId}`, { made: true })
        .expect(200);
      await as(alice)
        .post(`/workouts/${workoutId}/cards/${cardId}/sets`, {
          id: randomUUID(),
          reps: 3,
        })
        .expect(200);

      expect(await setRows(cardId)).toBe(2);
      const logged = await dataSource
        .getRepository(WorkoutSet)
        .findOneByOrFail({ id: setId });
      expect(logged.made).toBe(true);
    });

    it('keeps own ids, uses client ids and gives rows without an id a server id, in order', async () => {
      const workout = await workoutWithCard(alice);
      const kept = workout.exercises[0];
      const newCard = randomUUID();
      const newSet = randomUUID();

      const saved = await as(alice)
        .patch(`/workouts/${workout.id}`, {
          exercises: [
            {
              id: kept.id,
              exerciseId: squat.id,
              order: 1,
              sets: [
                { id: kept.sets[0].id, reps: 5, weight: 100 },
                { id: newSet, reps: 4, weight: 100 },
                { reps: 3, weight: 100 },
              ],
            },
            {
              id: newCard,
              exerciseId: bench.id,
              order: 2,
              sets: [{ reps: 8, weight: 60 }],
            },
          ],
        })
        .expect(200);

      const view = saved.body as WorkoutView;
      expect(view.exercises.map((card) => card.id)).toEqual([kept.id, newCard]);
      expect(view.exercises[0].sets.map((set) => set.id)).toEqual([
        kept.sets[0].id,
        newSet,
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ]);
      expect(view.exercises[0].sets.map((set) => set.reps)).toEqual([5, 4, 3]);
      expect(view.exercises[1].sets).toHaveLength(1);
    });

    it("409s on a card id or set id of another user's workout and writes nothing", async () => {
      const theirs = await workoutWithCard(alice);
      const mine = await workoutWithCard(bob);
      const myCard = mine.exercises[0];

      await as(bob)
        .patch(
          `/workouts/${mine.id}`,
          newCardBody(theirs.exercises[0].id, [randomUUID()]),
        )
        .expect(409);
      await as(bob)
        .patch(`/workouts/${mine.id}`, {
          exercises: [
            {
              id: myCard.id,
              exerciseId: squat.id,
              order: 1,
              sets: [
                { id: theirs.exercises[0].sets[0].id, reps: 1, weight: 1 },
              ],
            },
          ],
        })
        .expect(409);

      expect(await cardRows(mine.id)).toBe(1);
      expect(await setRows(myCard.id)).toBe(1);
      const theirSet = await dataSource
        .getRepository(WorkoutSet)
        .findOneByOrFail({ id: theirs.exercises[0].sets[0].id });
      expect(theirSet).toMatchObject({
        workoutExerciseId: theirs.exercises[0].id,
        reps: 5,
      });
    });
  });

  it('PATCH with the full cards repeated keeps the same rows', async () => {
    const workout = await workoutWithCard(alice);
    const body = {
      exercises: workout.exercises.map((card, order) => ({
        id: card.id,
        exerciseId: squat.id,
        order: order + 1,
        sets: card.sets.map((set) => ({ id: set.id, reps: 6, weight: 105 })),
      })),
    };

    const first = await as(alice)
      .patch(`/workouts/${workout.id}`, body)
      .expect(200);
    const replay = await as(alice)
      .patch(`/workouts/${workout.id}`, body)
      .expect(200);

    const shape = (view: WorkoutView) =>
      view.exercises.map((card) => ({
        id: card.id,
        sets: card.sets.map(({ id, reps }) => ({ id, reps })),
      }));
    expect(shape(replay.body as WorkoutView)).toEqual(
      shape(first.body as WorkoutView),
    );
    expect(shape(first.body as WorkoutView)).toEqual(
      shape(workout).map((card) => ({
        ...card,
        sets: card.sets.map((set) => ({ ...set, reps: 6 })),
      })),
    );
    expect(
      await dataSource
        .getRepository(WorkoutExercise)
        .countBy({ workoutId: workout.id }),
    ).toBe(1);
    expect(await setRows(workout.exercises[0].id)).toBe(1);
  });
});
