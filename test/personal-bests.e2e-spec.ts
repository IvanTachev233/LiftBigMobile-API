import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { addDays, todayUtc } from '../src/common/calendar-date';
import { RepMaxEntry } from '../src/lifts/entities/rep-max-entry.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface SetView {
  id: string;
  reps: number;
  weight: number | null;
  made: boolean | null;
  actualReps: number | null;
  actualWeight: number | null;
  pb: boolean;
}

type PbBars = Record<'1' | '2' | '3', number | null>;

interface WorkoutView {
  id: string;
  status: string;
  hasPb: boolean;
  exercises: {
    id: string;
    exerciseId: string;
    sets: SetView[];
    pbBars?: PbBars;
  }[];
}

interface SetResponse extends SetView {
  workoutPb: { hasPb: boolean; pbSetIds: string[] };
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
  best: { weightKg: number; achievedOn: string; source: string } | null;
  latest: { reps: number; entry: EntryView | null }[];
  entries: EntryView[];
}

interface SetBody {
  id?: string;
  reps: number;
  weight?: number | null;
  made?: boolean | null;
  actualReps?: number | null;
  actualWeight?: number | null;
}

describe('Personal bests (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let squat: Exercise;
  let row: Exercise;
  let client: E2eUser;

  const as = (user: E2eUser | null) => {
    const auth = (req: request.Test) =>
      user ? req.set('Authorization', `Bearer ${user.token}`) : req;
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string, body?: object) =>
        auth(server().post(path)).send(body),
      patch: (path: string, body: object) =>
        auth(server().patch(path)).send(body),
      put: (path: string, body: object) => auth(server().put(path)).send(body),
      delete: (path: string) => auth(server().delete(path)),
    };
  };

  const manual = (reps: number, weightKg: number, achievedOn: string) =>
    as(client)
      .post('/lifts/rep-maxes', {
        exerciseId: squat.id,
        reps,
        weightKg,
        achievedOn,
      })
      .expect(201);

  const history = async (user = client, exerciseId = squat.id) =>
    (await as(user).get(`/lifts/${exerciseId}/history`).expect(200))
      .body as History;

  const best = async (user = client) => (await history(user)).best;

  const newWorkout = async (date: string, user = client) =>
    (
      (await as(user).post('/workouts', { name: 'Heavy', date }).expect(201))
        .body as { id: string }
    ).id;

  // Saves one squat card with the given sets; returns the view.
  const saveSquat = async (
    workoutId: string,
    sets: SetBody[],
    cardId?: string,
    user = client,
  ) =>
    (
      await as(user)
        .patch(`/workouts/${workoutId}`, {
          exercises: [{ id: cardId, exerciseId: squat.id, order: 1, sets }],
        })
        .expect(200)
    ).body as WorkoutView;

  const single = (weight: number, made: boolean | null = true): SetBody => ({
    reps: 1,
    weight,
    made,
  });

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

  describe('auto-record', () => {
    it('records a made 1-rep PB from a PATCH and follows the set when it is missed', async () => {
      await manual(1, 100, '2026-09-01');
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(120)]);
      const [card] = saved.exercises;
      const [set] = card.sets;

      const { entries } = await history();
      const logged = entries.filter((e) => e.source === 'LOGGED_SET');
      expect(logged).toEqual([
        expect.objectContaining({
          reps: 1,
          weightKg: 120,
          achievedOn: '2026-09-10',
          workoutSetId: set.id,
        }),
      ]);
      expect(await best()).toMatchObject({
        weightKg: 120,
        source: 'LOGGED_SET',
      });

      await saveSquat(
        workoutId,
        [{ ...single(120), id: set.id, made: false }],
        card.id,
      );
      expect((await history()).entries.map((e) => e.source)).toEqual([
        'MANUAL',
      ]);
      expect(await best()).toMatchObject({ weightKg: 100, source: 'MANUAL' });
    });

    it('leaves no best when the only PB set is missed', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(120)]);
      const [card] = saved.exercises;
      await saveSquat(
        workoutId,
        [{ ...single(120), id: card.sets[0].id, made: false }],
        card.id,
      );
      expect(await history()).toMatchObject({ best: null, entries: [] });
    });

    it('follows a heavier change and deletes the entry when it drops below an earlier one', async () => {
      await manual(1, 110, '2026-09-01');
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(120)]);
      const [card] = saved.exercises;
      const setId = card.sets[0].id;

      await saveSquat(
        workoutId,
        [{ ...single(120), id: setId, actualWeight: 125 }],
        card.id,
      );
      const followed = (await history()).entries.find(
        (e) => e.workoutSetId === setId,
      );
      expect(followed).toMatchObject({ weightKg: 125, reps: 1 });
      expect((await best())?.weightKg).toBe(125);

      await saveSquat(
        workoutId,
        [{ ...single(120), id: setId, actualWeight: 105 }],
        card.id,
      );
      const after = await history();
      expect(after.entries.map((e) => [e.weightKg, e.source])).toEqual([
        [110, 'MANUAL'],
      ]);
      expect(after.best?.weightKg).toBe(110);
    });

    it('deletes the entry when the set is removed from the cards, and drops it from the chart data', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(100), single(120)]);
      const [card] = saved.exercises;
      expect((await history()).entries.map((e) => e.weightKg)).toEqual([
        100, 120,
      ]);

      await saveSquat(
        workoutId,
        [{ ...single(100), id: card.sets[0].id }],
        card.id,
      );
      const after = await history();
      expect(after.entries.map((e) => e.weightKg)).toEqual([100]);
      expect(after.best?.weightKg).toBe(100);
    });

    it('deletes entries with their workout and recomputes the best', async () => {
      await manual(1, 90, '2026-09-01');
      const workoutId = await newWorkout('2026-09-10');
      await saveSquat(workoutId, [single(120)]);
      expect((await best())?.weightKg).toBe(120);

      await as(client).delete(`/workouts/${workoutId}`).expect(200);
      const after = await history();
      expect(after.entries.map((e) => e.source)).toEqual(['MANUAL']);
      expect(after.best).toMatchObject({ weightKg: 90, source: 'MANUAL' });
    });

    it('records a 3-rep set as a 3RM without changing the 1RM best', async () => {
      await manual(1, 100, '2026-09-01');
      const workoutId = await newWorkout('2026-09-10');
      await saveSquat(workoutId, [
        { reps: 5, weight: 100, made: true, actualReps: 3, actualWeight: 110 },
        { reps: 4, weight: 150, made: true },
      ]);
      const after = await history();
      expect(after.latest.find((l) => l.reps === 3)?.entry).toMatchObject({
        weightKg: 110,
        source: 'LOGGED_SET',
      });
      expect(after.entries).toHaveLength(2);
      expect(after.best).toMatchObject({ weightKg: 100, source: 'MANUAL' });
    });

    it('records only the first of equal sets and nothing on untracked exercises', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = (
        await as(client)
          .patch(`/workouts/${workoutId}`, {
            exercises: [
              {
                exerciseId: squat.id,
                order: 1,
                sets: [single(100), single(100)],
              },
              { exerciseId: row.id, order: 2, sets: [single(80)] },
            ],
          })
          .expect(200)
      ).body as WorkoutView;
      const [first] = saved.exercises[0].sets;
      const { entries } = await history();
      expect(entries.map((e) => e.workoutSetId)).toEqual([first.id]);
      expect((await history(client, row.id)).entries).toEqual([]);
    });

    it('keeps an earned entry when a later, heavier day is logged first', async () => {
      const later = await newWorkout('2026-09-20');
      await saveSquat(later, [single(130)]);
      const earlier = await newWorkout('2026-09-10');
      await saveSquat(earlier, [single(120)]);
      expect(
        (await history()).entries.map((e) => [e.achievedOn, e.weightKg]),
      ).toEqual([
        ['2026-09-10', 120],
        ['2026-09-20', 130],
      ]);
      expect((await best())?.weightKg).toBe(130);
    });

    it('records from add set and set result calls', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(100, null)]);
      const [card] = saved.exercises;
      expect((await history()).entries).toEqual([]);

      await as(client)
        .patch(`/workouts/${workoutId}/sets/${card.sets[0].id}`, {
          made: true,
        })
        .expect(200);
      expect((await best())?.weightKg).toBe(100);

      await as(client)
        .post(`/workouts/${workoutId}/cards/${card.id}/sets`, {
          reps: 1,
          weight: 105,
          made: true,
        })
        .expect(201);
      expect((await best())?.weightKg).toBe(105);

      await as(client)
        .patch(`/workouts/${workoutId}/sets/${card.sets[0].id}`, {
          made: false,
        })
        .expect(200);
      expect((await history()).entries.map((e) => e.weightKg)).toEqual([105]);
    });

    it('records a coach edit of an assigned workout under the client', async () => {
      const coach = await registerAndLogin(app, 'COACH');
      await dataSource
        .getRepository(User)
        .update({ id: client.id }, { coachId: coach.id });
      const assigned = (
        await as(coach)
          .post(`/coach/clients/${client.id}/workouts`, {
            name: 'Assigned',
            date: '2026-09-10',
            exercises: [
              {
                exerciseId: squat.id,
                order: 1,
                sets: [{ reps: 1, weight: 100 }],
              },
            ],
          })
          .expect(201)
      ).body as WorkoutView;
      const [card] = assigned.exercises;
      const setId = card.sets[0].id;
      await as(client)
        .patch(`/workouts/${assigned.id}/sets/${setId}`, { made: true })
        .expect(200);

      const edited = (
        await as(coach)
          .put(`/coach/workouts/${assigned.id}`, {
            exercises: [
              {
                id: card.id,
                exerciseId: squat.id,
                order: 1,
                sets: [{ id: setId, reps: 1, weight: 130 }],
              },
            ],
          })
          .expect(200)
      ).body as WorkoutView;
      expect(edited.exercises[0].sets[0].pb).toBe(true);
      expect(edited.hasPb).toBe(true);

      const entries = await dataSource
        .getRepository(RepMaxEntry)
        .findBy({ workoutSetId: setId });
      expect(entries).toEqual([
        expect.objectContaining({ userId: client.id, weightKg: 130 }),
      ]);
      expect((await best())?.weightKg).toBe(130);
      expect((await history(coach)).entries).toEqual([]);
    });

    it('deletes entries of the planned workouts an abandon deletes and recomputes the best', async () => {
      const sports = (await as(client).get('/sports').expect(200)).body as {
        id: string;
        name: string;
      }[];
      const powerlifting = sports.find((s) => s.name === 'Powerlifting')!;
      const [summary] = (
        await as(client).get(`/sports/${powerlifting.id}/programs`).expect(200)
      ).body as { id: string }[];
      const program = (
        await as(client).get(`/programs/${summary.id}`).expect(200)
      ).body as { referenceLifts: { exerciseId: string }[] };
      const enrollment = (
        await as(client)
          .post('/program-enrollments', {
            programId: summary.id,
            startDate: addDays(todayUtc(), 3),
            maxes: program.referenceLifts.map((l) => ({
              exerciseId: l.exerciseId,
              weightKg: l.exerciseId === squat.id ? 140 : 100,
            })),
          })
          .expect(201)
      ).body as { id: string; workouts: WorkoutView[] };
      const first = enrollment.workouts[0];
      const squatCard = first.exercises.find((c) => c.exerciseId === squat.id)!;
      await as(client)
        .patch(`/workouts/${first.id}/sets/${squatCard.sets[0].id}`, {
          made: true,
          actualReps: 1,
          actualWeight: 150,
        })
        .expect(200);
      expect((await best())?.weightKg).toBe(150);
      await as(client)
        .patch(`/workouts/${first.id}`, { status: 'PLANNED' })
        .expect(200);

      await as(client)
        .post(`/program-enrollments/${enrollment.id}/abandon`)
        .expect(201);
      const after = await history();
      expect(after.entries.map((e) => [e.weightKg, e.source])).toEqual([
        [140, 'PROGRAM_SETUP'],
      ]);
      expect(after.best).toMatchObject({
        weightKg: 140,
        source: 'PROGRAM_SETUP',
      });
    });

    it('records a set that becomes a PB when a heavier set of the same assigned workout is missed', async () => {
      await manual(1, 80, '2026-09-01');
      const coach = await registerAndLogin(app, 'COACH');
      await dataSource
        .getRepository(User)
        .update({ id: client.id }, { coachId: coach.id });
      const assigned = (
        await as(coach)
          .post(`/coach/clients/${client.id}/workouts`, {
            name: 'Assigned',
            date: '2026-09-10',
            exercises: [
              {
                exerciseId: squat.id,
                order: 1,
                sets: [
                  { reps: 1, weight: 100 },
                  { reps: 1, weight: 110 },
                ],
              },
            ],
          })
          .expect(201)
      ).body as WorkoutView;
      const [set1, set2] = assigned.exercises[0].sets;
      const result = async (setId: string, made: boolean) =>
        (
          await as(client)
            .patch(`/workouts/${assigned.id}/sets/${setId}`, { made })
            .expect(200)
        ).body as SetResponse;

      expect((await result(set2.id, true)).workoutPb.pbSetIds).toEqual([
        set2.id,
      ]);
      expect((await result(set1.id, true)).workoutPb.pbSetIds).toEqual([
        set2.id,
      ]);
      const missed = await result(set2.id, false);
      expect(missed.workoutPb).toEqual({ hasPb: true, pbSetIds: [set1.id] });

      const after = await history();
      expect(
        after.entries.map((e) => [e.weightKg, e.source, e.workoutSetId]),
      ).toEqual([
        [80, 'MANUAL', null],
        [100, 'LOGGED_SET', set1.id],
      ]);
      expect(after.best).toMatchObject({ weightKg: 100, source: 'LOGGED_SET' });
    });

    it('deletes the entry of a set lowered below sets recorded in the same save', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [
        single(90),
        single(95),
        single(100),
      ]);
      const [card] = saved.exercises;
      const [a, b, c] = card.sets;
      expect(card.sets.map((s) => s.pb)).toEqual([true, true, true]);

      const lowered = await saveSquat(
        workoutId,
        [
          { ...single(90), id: a.id },
          { ...single(95), id: b.id, actualWeight: 85 },
          { ...single(100), id: c.id },
        ],
        card.id,
      );
      expect(lowered.exercises[0].sets.map((s) => s.pb)).toEqual([
        true,
        false,
        true,
      ]);
      expect(
        (await history()).entries.map((e) => [e.weightKg, e.workoutSetId]),
      ).toEqual([
        [90, a.id],
        [100, c.id],
      ]);
    });

    it('never records a set again once its entry was removed', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(120)]);
      const [card] = saved.exercises;
      const [entry] = (await history()).entries;
      await as(client).delete(`/lifts/rep-maxes/${entry.id}`).expect(200);

      await saveSquat(
        workoutId,
        [{ ...single(120), id: card.sets[0].id, actualWeight: 125 }],
        card.id,
      );
      expect(await history()).toMatchObject({ best: null, entries: [] });
      expect(
        await dataSource
          .getRepository(RepMaxEntry)
          .countBy({ workoutSetId: card.sets[0].id }),
      ).toBe(1);
    });

    it('has no from-set route', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(120)]);
      await as(client)
        .post(`/lifts/rep-maxes/from-set/${saved.exercises[0].sets[0].id}`)
        .expect(404);
    });
  });

  describe('remove', () => {
    it('removes an own entry, moving latest and best to the next heaviest', async () => {
      await manual(1, 100, '2026-09-01');
      await manual(1, 120, '2026-09-05');
      const top = (await history()).entries.find((e) => e.weightKg === 120)!;

      const removed = await as(client)
        .delete(`/lifts/rep-maxes/${top.id}`)
        .expect(200);
      expect(removed.body).toMatchObject({
        entry: { id: top.id },
        best: { weightKg: 100 },
      });
      const after = await history();
      expect(after.entries.map((e) => e.id)).not.toContain(top.id);
      expect(after.latest.find((l) => l.reps === 1)?.entry?.weightKg).toBe(100);
      expect(after.best).toMatchObject({
        weightKg: 100,
        achievedOn: '2026-09-01',
      });
      const bests = (
        await as(client).get(`/lifts/best?exerciseIds=${squat.id}`).expect(200)
      ).body as { weightKg: number }[];
      expect(bests.map((b) => b.weightKg)).toEqual([100]);
    });

    it("404s on another user's entry, a removed entry and an unknown id; 401 without a login", async () => {
      await manual(1, 100, '2026-09-01');
      const [entry] = (await history()).entries;
      const other = await registerAndLogin(app);
      await as(other).delete(`/lifts/rep-maxes/${entry.id}`).expect(404);
      await as(null).delete(`/lifts/rep-maxes/${entry.id}`).expect(401);

      await as(client).delete(`/lifts/rep-maxes/${entry.id}`).expect(200);
      await as(client).delete(`/lifts/rep-maxes/${entry.id}`).expect(404);
      await as(client)
        .delete('/lifts/rep-maxes/00000000-0000-4000-8000-000000000000')
        .expect(404);
      expect(await history()).toMatchObject({ best: null, entries: [] });
    });

    it('leaves the enrollment maxes snapshot unchanged', async () => {
      const sports = (await as(client).get('/sports').expect(200)).body as {
        id: string;
        name: string;
      }[];
      const powerlifting = sports.find((s) => s.name === 'Powerlifting')!;
      const [summary] = (
        await as(client).get(`/sports/${powerlifting.id}/programs`).expect(200)
      ).body as { id: string }[];
      const program = (
        await as(client).get(`/programs/${summary.id}`).expect(200)
      ).body as { referenceLifts: { exerciseId: string }[] };
      await as(client)
        .post('/program-enrollments', {
          programId: summary.id,
          startDate: addDays(todayUtc(), 3),
          maxes: program.referenceLifts.map((l) => ({
            exerciseId: l.exerciseId,
            weightKg: 140,
          })),
        })
        .expect(201);
      const [setup] = (await history()).entries;
      await as(client).delete(`/lifts/rep-maxes/${setup.id}`).expect(200);

      const { active } = (
        await as(client).get('/program-enrollments/active').expect(200)
      ).body as { active: { maxesSnapshot: Record<string, number> } };
      expect(active.maxesSnapshot[squat.id]).toBe(140);
      expect(await best()).toBeNull();
    });
  });

  describe('pb bars', () => {
    const barsOf = async (workoutId: string) =>
      (
        (await as(client).get(`/workouts/${workoutId}`).expect(200))
          .body as WorkoutView
      ).exercises.map((card) => card.pbBars);

    it('gives the heaviest earlier entry per rep count, null where there is none', async () => {
      await manual(1, 100, '2026-09-01');
      await manual(3, 90, '2026-09-02');
      await manual(1, 95, '2026-09-03');
      const workoutId = await newWorkout('2026-09-10');
      await saveSquat(workoutId, [single(50, null)]);
      expect(await barsOf(workoutId)).toEqual([{ 1: 100, 2: null, 3: 90 }]);
    });

    it("leaves out later-dated, removed and other users' entries", async () => {
      await manual(1, 100, '2026-09-01');
      await manual(1, 150, '2026-09-20');
      await manual(2, 130, '2026-09-05');
      const removed = (await history()).entries.find((e) => e.reps === 2)!;
      await as(client).delete(`/lifts/rep-maxes/${removed.id}`).expect(200);
      const other = await registerAndLogin(app);
      await as(other)
        .post('/lifts/rep-maxes', {
          exerciseId: squat.id,
          reps: 3,
          weightKg: 200,
          achievedOn: '2026-09-01',
        })
        .expect(201);

      const workoutId = await newWorkout('2026-09-10');
      await saveSquat(workoutId, [single(50, null)]);
      expect(await barsOf(workoutId)).toEqual([{ 1: 100, 2: null, 3: null }]);
    });

    it("leaves out this workout's own PB set and counts a same-day entry of another workout", async () => {
      await manual(1, 100, '2026-09-01');
      const sameDay = await newWorkout('2026-09-10');
      await saveSquat(sameDay, [single(110)]);

      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(120)]);
      expect(saved.exercises[0].sets[0].pb).toBe(true);
      expect(saved.exercises[0].pbBars).toEqual({ 1: 110, 2: null, 3: null });
      expect(await barsOf(workoutId)).toEqual([{ 1: 110, 2: null, 3: null }]);
      expect(await barsOf(sameDay)).toEqual([{ 1: 120, 2: null, 3: null }]);
    });

    it('gives every card of the PATCH response bars, all null with no entries', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = (
        await as(client)
          .patch(`/workouts/${workoutId}`, {
            exercises: [
              { exerciseId: squat.id, order: 1, sets: [single(50, null)] },
              { exerciseId: row.id, order: 2, sets: [single(40, null)] },
            ],
          })
          .expect(200)
      ).body as WorkoutView;
      expect(saved.exercises.map((card) => card.pbBars)).toEqual([
        { 1: null, 2: null, 3: null },
        { 1: null, 2: null, 3: null },
      ]);
    });

    it('leaves lists and set responses without bars', async () => {
      await manual(1, 100, '2026-09-01');
      const workoutId = await newWorkout(addDays(todayUtc(), 2));
      const saved = await saveSquat(workoutId, [single(50, null)]);
      const [card] = saved.exercises;
      for (const path of ['/workouts', '/workouts/upcoming']) {
        const list = (await as(client).get(path).expect(200))
          .body as WorkoutView[];
        const listed = list.find((w) => w.id === workoutId)!;
        expect(listed.exercises[0]).not.toHaveProperty('pbBars');
      }
      const result = (
        await as(client)
          .patch(`/workouts/${workoutId}/sets/${card.sets[0].id}`, {
            made: true,
          })
          .expect(200)
      ).body as object;
      expect(result).not.toHaveProperty('pbBars');
      const added = (
        await as(client)
          .post(`/workouts/${workoutId}/cards/${card.id}/sets`, { reps: 1 })
          .expect(201)
      ).body as object;
      expect(added).not.toHaveProperty('pbBars');
    });
  });

  describe('workout view', () => {
    it('marks the PB set and the workout in the PATCH response and every read', async () => {
      await manual(1, 110, '2026-09-01');
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [single(100), single(120)]);
      expect(saved.hasPb).toBe(true);
      expect(saved.exercises[0].sets.map((s) => s.pb)).toEqual([false, true]);

      const plain = await newWorkout('2026-09-11');
      await saveSquat(plain, [single(50)]);

      const one = (await as(client).get(`/workouts/${workoutId}`).expect(200))
        .body as WorkoutView;
      expect(one.exercises[0].sets.map((s) => s.pb)).toEqual([false, true]);
      const list = (await as(client).get('/workouts').expect(200))
        .body as WorkoutView[];
      expect(list.map((w) => [w.id, w.hasPb])).toEqual(
        expect.arrayContaining([
          [workoutId, true],
          [plain, false],
        ]),
      );
      expect(list.every((w) => typeof w.hasPb === 'boolean')).toBe(true);

      const [entry] = (await history()).entries.filter(
        (e) => e.source === 'LOGGED_SET',
      );
      await as(client).delete(`/lifts/rep-maxes/${entry.id}`).expect(200);
      const after = (await as(client).get(`/workouts/${workoutId}`).expect(200))
        .body as WorkoutView;
      expect(after.hasPb).toBe(false);
      expect(after.exercises[0].sets.map((s) => s.pb)).toEqual([false, false]);
    });

    it('shows hasPb in upcoming workouts', async () => {
      const workoutId = await newWorkout(addDays(todayUtc(), 2));
      await saveSquat(workoutId, [single(120)]);
      const upcoming = (await as(client).get('/workouts/upcoming').expect(200))
        .body as WorkoutView[];
      expect(upcoming.find((w) => w.id === workoutId)).toMatchObject({
        hasPb: true,
        exercises: [{ sets: [{ pb: true }] }],
      });
    });

    it('returns every set pb of the workout from set result and add set calls', async () => {
      const workoutId = await newWorkout('2026-09-10');
      const saved = await saveSquat(workoutId, [
        single(120),
        single(110, null),
      ]);
      const [card] = saved.exercises;
      const [heavy, light] = card.sets;

      // Missing the heavy set makes the light one the PB
      await as(client)
        .patch(`/workouts/${workoutId}/sets/${light.id}`, { made: true })
        .expect(200)
        .expect(({ body }: { body: SetResponse }) => {
          expect(body).toMatchObject({ id: light.id, pb: false });
          expect(body.workoutPb).toEqual({
            hasPb: true,
            pbSetIds: [heavy.id],
          });
        });
      const missed = (
        await as(client)
          .patch(`/workouts/${workoutId}/sets/${heavy.id}`, { made: false })
          .expect(200)
      ).body as SetResponse;
      expect(missed).toMatchObject({ id: heavy.id, pb: false });
      expect(missed.workoutPb).toEqual({ hasPb: true, pbSetIds: [light.id] });

      const added = (
        await as(client)
          .post(`/workouts/${workoutId}/cards/${card.id}/sets`, {
            reps: 1,
            weight: 130,
            made: true,
          })
          .expect(201)
      ).body as SetResponse;
      expect(added.pb).toBe(true);
      expect(added.workoutPb.pbSetIds.sort()).toEqual(
        [light.id, added.id].sort(),
      );

      const result = (
        await as(client)
          .patch(`/workouts/${workoutId}/sets/${heavy.id}`, {
            made: true,
            actualWeight: 140,
          })
          .expect(200)
      ).body as SetResponse;
      expect(result.pb).toBe(true);
    });

    it('shows pb and hasPb in the coach views', async () => {
      const coach = await registerAndLogin(app, 'COACH');
      await dataSource
        .getRepository(User)
        .update({ id: client.id }, { coachId: coach.id });
      const assigned = (
        await as(coach)
          .post(`/coach/clients/${client.id}/workouts`, {
            name: 'Assigned',
            date: '2026-09-10',
            exercises: [
              {
                exerciseId: squat.id,
                order: 1,
                sets: [{ reps: 1, weight: 100 }],
              },
            ],
          })
          .expect(201)
      ).body as WorkoutView;
      expect(assigned.hasPb).toBe(false);
      const setId = assigned.exercises[0].sets[0].id;
      await as(client)
        .patch(`/workouts/${assigned.id}/sets/${setId}`, { made: true })
        .expect(200);

      const one = (
        await as(coach).get(`/coach/workouts/${assigned.id}`).expect(200)
      ).body as WorkoutView;
      expect(one.hasPb).toBe(true);
      expect(one.exercises[0].sets[0].pb).toBe(true);
      const list = (
        await as(coach).get(`/coach/clients/${client.id}/workouts`).expect(200)
      ).body as WorkoutView[];
      expect(list.map((w) => w.hasPb)).toEqual([true]);
    });
  });
});
