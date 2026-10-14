import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface CardView {
  id: string;
  exerciseId: string;
  notes: string | null;
  sets: { id: string; notes: string | null }[];
}

interface WorkoutView {
  id: string;
  exercises: CardView[];
}

interface CardBody {
  id?: string;
  exerciseId: string;
  order: number;
  notes?: string | null;
  sets: { id?: string; reps: number; weight?: number; notes?: string }[];
}

describe('Card notes for the athlete (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let squat: Exercise;
  let row: Exercise;
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

  const clientView = async (id: string) =>
    (await as(client).get(`/workouts/${id}`).expect(200)).body as WorkoutView;

  const notesOf = (workout: WorkoutView) =>
    workout.exercises.map((card) => card.notes);

  const assign = async (exercises: CardBody[]) =>
    (
      await as(coach)
        .post(`/coach/clients/${client.id}/workouts`, {
          name: 'Assigned',
          date: '2026-10-14',
          exercises,
        })
        .expect(201)
    ).body as WorkoutView;

  const edit = async (id: string, exercises: CardBody[]) =>
    (await as(coach).put(`/coach/workouts/${id}`, { exercises }).expect(200))
      .body as WorkoutView;

  // The saved cards sent back as they are, with changes per card
  const keep = (workout: WorkoutView, changes: Partial<CardBody>[] = []) =>
    workout.exercises.map(
      (card, i): CardBody => ({
        id: card.id,
        exerciseId: card.exerciseId,
        order: i + 1,
        sets: card.sets.map((set) => ({ id: set.id, reps: 5 })),
        ...changes[i],
      }),
    );

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
    coach = await registerAndLogin(app, 'COACH');
    await dataSource
      .getRepository(User)
      .update({ id: client.id }, { coachId: coach.id });
  });

  afterAll(async () => {
    await app.close();
  });

  it('saves the note a coach writes on a card and shows it to the client', async () => {
    const created = await assign([
      {
        exerciseId: squat.id,
        order: 1,
        notes: 'Pause 2 s at the bottom',
        sets: [{ reps: 5, weight: 100, notes: 'Belt on' }],
      },
      { exerciseId: row.id, order: 2, sets: [{ reps: 8 }] },
    ]);
    expect(notesOf(created)).toEqual(['Pause 2 s at the bottom', null]);

    const seen = await clientView(created.id);
    expect(notesOf(seen)).toEqual(['Pause 2 s at the bottom', null]);
    expect(seen.exercises[0].sets[0].notes).toBe('Belt on');
  });

  it('changes, keeps or clears the note on a coach edit', async () => {
    const created = await assign([
      {
        exerciseId: squat.id,
        order: 1,
        notes: 'Slow down',
        sets: [{ reps: 5 }],
      },
      { exerciseId: row.id, order: 2, sets: [{ reps: 8 }] },
    ]);

    // Left out = unchanged
    expect(notesOf(await edit(created.id, keep(created)))).toEqual([
      'Slow down',
      null,
    ]);

    const changed = await edit(
      created.id,
      keep(created, [{ notes: 'Stay tight' }, { notes: 'Squeeze at the top' }]),
    );
    expect(notesOf(changed)).toEqual(['Stay tight', 'Squeeze at the top']);

    // null and blank text clear it
    const cleared = await edit(
      created.id,
      keep(created, [{ notes: null }, { notes: '   ' }]),
    );
    expect(notesOf(cleared)).toEqual([null, null]);
  });

  it('keeps the note with its card when the coach reorders the cards', async () => {
    const created = await assign([
      {
        exerciseId: squat.id,
        order: 1,
        notes: 'Squat note',
        sets: [{ reps: 5 }],
      },
      { exerciseId: row.id, order: 2, notes: 'Row note', sets: [{ reps: 8 }] },
    ]);
    const [first, second] = keep(created);
    const swapped = await edit(created.id, [
      { ...second, order: 1 },
      { ...first, order: 2 },
    ]);
    expect(
      swapped.exercises.map((card) => [card.exerciseId, card.notes]),
    ).toEqual([
      [row.id, 'Row note'],
      [squat.id, 'Squat note'],
    ]);
  });

  it("can't be changed by the client", async () => {
    const created = await assign([
      {
        exerciseId: squat.id,
        order: 1,
        notes: 'Coach note',
        sets: [{ reps: 5 }],
      },
    ]);
    const [card] = created.exercises;

    await as(client)
      .patch(`/workouts/${created.id}`, {
        exercises: [
          {
            id: card.id,
            exerciseId: squat.id,
            order: 1,
            notes: 'Changed by the client',
            sets: [{ id: card.sets[0].id, reps: 5, weight: null }],
          },
        ],
      })
      .expect(403);
    await as(client)
      .patch(`/workouts/${created.id}/sets/${card.sets[0].id}`, { made: true })
      .expect(200);
    await as(client)
      .patch(`/workouts/${created.id}`, { status: 'COMPLETED' })
      .expect(200);

    expect(notesOf(await clientView(created.id))).toEqual(['Coach note']);
  });

  it('is not written on a self-made workout', async () => {
    const manual = (
      await as(client)
        .post('/workouts', { name: 'Manual', date: '2026-10-14' })
        .expect(201)
    ).body as WorkoutView;
    const saved = (
      await as(client)
        .patch(`/workouts/${manual.id}`, {
          exercises: [
            {
              exerciseId: squat.id,
              order: 1,
              notes: 'My own note',
              sets: [{ reps: 5, weight: 100 }],
            },
          ],
        })
        .expect(200)
    ).body as WorkoutView;
    expect(notesOf(saved)).toEqual([null]);
  });
});
