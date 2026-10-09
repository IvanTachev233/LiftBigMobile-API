import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { addDays, todayUtc } from '../src/common/calendar-date';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface SetView {
  id: string;
  reps: number;
  weight: number | null;
  prescribedPercent: number | null;
  referenceExerciseId: string | null;
  made: boolean | null;
}

interface WorkoutView {
  id: string;
  name: string;
  date: string;
  status: string;
  source: string;
  program: { enrollmentId: string; name: string } | null;
  exercises: {
    id: string;
    exerciseId: string;
    exercise: { name: string };
    sets: SetView[];
  }[];
}

const day = (date: string) => new Date(date).toISOString().slice(0, 10);

// Ticket acceptance: a client picks the seeded Powerlifting sample, enters
// maxes and a start date, logs the first session and records a rep max.
describe('Premade programs, end to end (e2e)', () => {
  let app: INestApplication<App>;
  let client: E2eUser;

  const call = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${client.token}`);

  beforeAll(async () => {
    app = await createE2eApp();
    client = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('enrolls, logs the first session and records a rep max', async () => {
    const manual = (
      await call('post', '/workouts')
        .send({ name: 'My own session', date: addDays(todayUtc(), 2) })
        .expect(201)
    ).body as { id: string };
    const manualBefore = (
      await call('get', `/workouts/${manual.id}`).expect(200)
    ).body as WorkoutView;

    // Catalog
    const sports = (await call('get', '/sports').expect(200)).body as {
      id: string;
      name: string;
    }[];
    expect(sports.map((s) => s.name)).toEqual([
      'Olympic Weightlifting',
      'Powerlifting',
    ]);
    const powerlifting = sports[1];
    const [summary] = (
      await call('get', `/sports/${powerlifting.id}/programs`).expect(200)
    ).body as { id: string; name: string; authorName: string }[];
    expect(summary).toMatchObject({
      name: 'Sample Powerlifting Program',
      authorName: 'LiftBig',
    });
    const program = (await call('get', `/programs/${summary.id}`).expect(200))
      .body as { referenceLifts: { exerciseId: string; label: string }[] };
    expect(program.referenceLifts.map((l) => l.label)).toEqual([
      'Squat',
      'Bench Press',
      'Deadlift',
    ]);
    const [squat, bench, deadlift] = program.referenceLifts.map(
      (l) => l.exerciseId,
    );

    // Enroll three days ahead
    const startDate = addDays(todayUtc(), 3);
    const enrollment = (
      await call('post', '/program-enrollments')
        .send({
          programId: summary.id,
          startDate,
          maxes: [
            { exerciseId: squat, weightKg: 140 },
            { exerciseId: bench, weightKg: 100 },
            { exerciseId: deadlift, weightKg: 180 },
          ],
        })
        .expect(201)
    ).body as { id: string; status: string; workouts: WorkoutView[] };
    expect(enrollment.status).toBe('ACTIVE');
    expect(enrollment.workouts).toHaveLength(12);

    // First session: Squat Day of week 1 on the start date
    const first = (
      await call('get', `/workouts/${enrollment.workouts[0].id}`).expect(200)
    ).body as WorkoutView;
    expect(day(first.date)).toBe(startDate);
    expect(first).toMatchObject({
      name: 'Sample Powerlifting Program: Squat Day',
      status: 'PLANNED',
      source: 'program',
      program: {
        enrollmentId: enrollment.id,
        name: 'Sample Powerlifting Program',
      },
    });
    expect(
      first.exercises.map((card) => ({
        name: card.exercise.name,
        sets: card.sets.length,
        reps: card.sets[0].reps,
        weight: card.sets[0].weight,
        percent: card.sets[0].prescribedPercent,
        reference: card.sets[0].referenceExerciseId,
      })),
    ).toEqual([
      // 140 x 70% = 98 -> 97.5
      {
        name: 'Back Squat',
        sets: 5,
        reps: 5,
        weight: 97.5,
        percent: 70,
        reference: squat,
      },
      // Pause Squat from the Back Squat max: 140 x 55% = 77 -> 77.5
      {
        name: 'Pause Squat',
        sets: 3,
        reps: 3,
        weight: 77.5,
        percent: 55,
        reference: squat,
      },
      // 100 x 60% = 60
      {
        name: 'Bench Press',
        sets: 3,
        reps: 5,
        weight: 60,
        percent: 60,
        reference: bench,
      },
    ]);

    // Log every set; the last squat set only made 3 reps at 100 kg
    const squatSets = first.exercises[0].sets;
    const lastSquat = squatSets[squatSets.length - 1];
    for (const card of first.exercises) {
      for (const set of card.sets) {
        const body =
          set.id === lastSquat.id
            ? { made: true, actualReps: 3, actualWeight: 100 }
            : { made: true };
        const logged = (
          await call('patch', `/workouts/${first.id}/sets/${set.id}`)
            .send(body)
            .expect(200)
        ).body as SetView;
        expect(logged.made).toBe(true);
      }
    }
    const logged = (await call('get', `/workouts/${first.id}`).expect(200))
      .body as WorkoutView;
    expect(logged.status).toBe('IN_PROGRESS');
    expect(
      logged.exercises.flatMap((c) => c.sets).every((s) => s.made === true),
    ).toBe(true);

    const completed = (
      await call('patch', `/workouts/${first.id}`)
        .send({ status: 'COMPLETED' })
        .expect(200)
    ).body as WorkoutView;
    expect(completed).toMatchObject({ status: 'COMPLETED', source: 'program' });

    // Record the 3-rep squat set as a rep max
    const recorded = (
      await call('post', `/lifts/rep-maxes/from-set/${lastSquat.id}`).expect(
        201,
      )
    ).body as { entry: { reps: number; weightKg: number } };
    expect(recorded.entry).toMatchObject({
      reps: 3,
      weightKg: 100,
      achievedOn: startDate,
      source: 'LOGGED_SET',
      workoutSetId: lastSquat.id,
    });

    const history = (await call('get', `/lifts/${squat}/history`).expect(200))
      .body as {
      best: { weightKg: number; source: string };
      latest: { reps: number; entry: { weightKg: number } | null }[];
      entries: { reps: number; weightKg: number; source: string }[];
    };
    expect(history.best).toMatchObject({
      weightKg: 140,
      source: 'PROGRAM_SETUP',
    });
    expect(
      history.latest.map((l) => [l.reps, l.entry?.weightKg ?? null]),
    ).toEqual([
      [1, 140],
      [2, null],
      [3, 100],
    ]);
    expect(history.entries.map((e) => [e.reps, e.weightKg, e.source])).toEqual(
      expect.arrayContaining([
        [1, 140, 'PROGRAM_SETUP'],
        [3, 100, 'LOGGED_SET'],
      ]),
    );

    // The manual workout is untouched
    const manualAfter = (
      await call('get', `/workouts/${manual.id}`).expect(200)
    ).body as WorkoutView;
    expect(manualAfter).toEqual(manualBefore);
    expect(manualAfter).toMatchObject({ source: 'manual', program: null });
  });
});
