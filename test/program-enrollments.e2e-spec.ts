import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { addDays, todayUtc } from '../src/common/calendar-date';
import { WeightUnit } from '../src/common/weight-unit';
import { LiftRecordSource } from '../src/lifts/entities/lift-record-source';
import { RepMaxEntry } from '../src/lifts/entities/rep-max-entry.entity';
import { UserBestLift } from '../src/lifts/entities/user-best-lift.entity';
import { ProgramEnrollment } from '../src/programs/entities/program-enrollment.entity';
import { EnrollmentService } from '../src/programs/enrollment.service';
import { SYSTEM_ACTOR } from '../src/programs/program-actor';
import { ProgramService } from '../src/programs/program.service';
import { Workout } from '../src/workouts/entities/workout.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';
import { createSportWithExercises } from './e2e-fixtures';

interface SetView {
  id: string;
  reps: number;
  weight: number | null;
  prescribedPercent: number | null;
  referenceExerciseId: string | null;
}

interface WorkoutView {
  id: string;
  name: string;
  date: string;
  status: string;
  programSessionId: string;
  exercises: { exerciseId: string; order: number; sets: SetView[] }[];
}

interface EnrollmentView {
  id: string;
  status: string;
  startDate: string;
  programId: string;
  programVersion: number;
  maxesSnapshot: Record<string, number>;
  program: { name: string };
  workouts: WorkoutView[];
}

const day = (date: string) => new Date(date).toISOString().slice(0, 10);

describe('Program enrollments (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let programId: string;
  let ids: { squat: string; bench: string; pause: string; row: string };
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
    patch: (path: string, body: object) =>
      request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body),
  });

  const start = addDays(todayUtc(), 6);
  const maxes = (squat = 140, bench = 100) => [
    { exerciseId: ids.squat, weightKg: squat },
    { exerciseId: ids.bench, weightKg: bench },
  ];
  const enroll = (user: E2eUser, body: object = {}) =>
    as(user).post('/program-enrollments', {
      programId,
      startDate: start,
      maxes: maxes(),
      ...body,
    });

  const setsOf = (workout: WorkoutView, exerciseId: string) =>
    workout.exercises.find((c) => c.exerciseId === exerciseId)!.sets;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    const { sport, exercises } = await createSportWithExercises(
      dataSource,
      ['Squat', 'Bench', 'Pause Squat', 'Row'],
      2,
    );
    ids = {
      squat: exercises.Squat.id,
      bench: exercises.Bench.id,
      pause: exercises['Pause Squat'].id,
      row: exercises.Row.id,
    };
    // 4 weeks x 3 sessions on days 0, 2 and 4.
    const programs = app.get(ProgramService);
    const draft = await programs.createDraft(SYSTEM_ACTOR, {
      sportId: sport.id,
      name: 'Enrollment Test',
      durationWeeks: 4,
      sessionsPerWeek: 3,
      sessions: [1, 2, 3, 4].flatMap((week) =>
        [0, 2, 4].map((dayOffset, i) => ({
          week,
          sessionIndex: i + 1,
          dayOffset,
          title: `Day ${i + 1}`,
          exercises: [
            {
              exerciseId: ids.squat,
              sets: 3,
              reps: 5,
              percentOf1RM: 70,
              referenceExerciseId: ids.squat,
            },
            {
              exerciseId: ids.pause,
              sets: 2,
              reps: 3,
              percentOf1RM: 60,
              referenceExerciseId: ids.squat,
            },
            {
              exerciseId: ids.bench,
              sets: 3,
              reps: 5,
              percentOf1RM: 75,
              referenceExerciseId: ids.bench,
            },
            { exerciseId: ids.row, sets: 3, reps: 8 },
          ],
        })),
      ),
    });
    programId = (await programs.publish(SYSTEM_ACTOR, draft.id)).id;
  });

  beforeEach(async () => {
    client = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is for logged-in clients only', async () => {
    await request(app.getHttpServer())
      .get('/program-enrollments/active')
      .expect(401);
    const coach = await registerAndLogin(app, 'COACH');
    await enroll(coach).expect(403);
  });

  it('creates one PLANNED workout per session on the schedule dates', async () => {
    const response = await enroll(client).expect(201);
    const enrollment = response.body as EnrollmentView;

    expect(enrollment).toMatchObject({
      status: 'ACTIVE',
      startDate: start,
      programId,
      programVersion: 1,
      maxesSnapshot: { [ids.squat]: 140, [ids.bench]: 100 },
    });
    const offsets = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];
    expect(enrollment.workouts.map((w) => day(w.date))).toEqual(
      offsets.map((n) => addDays(start, n)),
    );
    expect(enrollment.workouts.every((w) => w.status === 'PLANNED')).toBe(true);
    expect(enrollment.workouts[1].name).toBe('Enrollment Test: Day 2');

    const first = enrollment.workouts[0];
    expect(first.exercises.map((c) => c.exerciseId)).toEqual([
      ids.squat,
      ids.pause,
      ids.bench,
      ids.row,
    ]);
    // 140 x 70% = 98 -> 97.5; Pause Squat uses the squat max: 140 x 60% = 84 -> 85.
    expect(setsOf(first, ids.squat)).toHaveLength(3);
    expect(setsOf(first, ids.squat)[0]).toMatchObject({
      reps: 5,
      weight: 97.5,
      prescribedPercent: 70,
      referenceExerciseId: ids.squat,
    });
    expect(setsOf(first, ids.pause)[0]).toMatchObject({
      weight: 85,
      prescribedPercent: 60,
      referenceExerciseId: ids.squat,
    });
    expect(setsOf(first, ids.bench)[0].weight).toBe(75);
    expect(setsOf(first, ids.row)[0]).toMatchObject({
      weight: null,
      prescribedPercent: null,
      referenceExerciseId: null,
    });

    const active = (await as(client).get('/program-enrollments/active'))
      .body as { active: EnrollmentView };
    expect(active.active.id).toBe(enrollment.id);
    expect(active.active.workouts).toHaveLength(12);
  });

  it('rounds targets in pounds for lb users', async () => {
    await dataSource
      .getRepository(User)
      .update({ id: client.id }, { weightUnit: WeightUnit.LB });
    const enrollment = (await enroll(client).expect(201))
      .body as EnrollmentView;
    // 98 kg = 216.05 lb -> 215 lb = 97.52 kg
    expect(setsOf(enrollment.workouts[0], ids.squat)[0].weight).toBe(97.52);
  });

  it('needs a max for every reference lift and names the missing ones', async () => {
    const response = await enroll(client, { maxes: [] }).expect(400);
    expect(JSON.stringify(response.body)).toContain('Squat');
    expect(JSON.stringify(response.body)).toContain('Bench');
    await enroll(client, {
      maxes: [...maxes(), { exerciseId: ids.row, weightKg: 60 }],
    }).expect(400);
  });

  it('rejects a start date before yesterday', async () => {
    await enroll(client, { startDate: addDays(todayUtc(), -2) }).expect(400);
    await enroll(client, { startDate: '2026-02-30' }).expect(400);
    await enroll(client, { startDate: addDays(todayUtc(), -1) }).expect(201);
  });

  it('404s on a program that is not published', async () => {
    await enroll(client, {
      programId: '00000000-0000-4000-8000-000000000000',
    }).expect(404);
  });

  it('records entered maxes that differ from the best, and snapshots them as entered', async () => {
    await as(client)
      .post('/lifts/rep-maxes', {
        exerciseId: ids.squat,
        reps: 1,
        weightKg: 150,
        achievedOn: '2026-09-01',
      })
      .expect(201);
    await as(client)
      .post('/lifts/rep-maxes', {
        exerciseId: ids.bench,
        reps: 1,
        weightKg: 100,
        achievedOn: '2026-09-01',
      })
      .expect(201);

    const enrollment = (await enroll(client).expect(201))
      .body as EnrollmentView;
    expect(enrollment.maxesSnapshot[ids.squat]).toBe(140);
    expect(setsOf(enrollment.workouts[0], ids.squat)[0].weight).toBe(97.5);

    const setup = await dataSource
      .getRepository(RepMaxEntry)
      .findBy({ userId: client.id, source: LiftRecordSource.PROGRAM_SETUP });
    expect(setup.map((e) => [e.exerciseId, e.weightKg, e.reps])).toEqual([
      [ids.squat, 140, 1],
    ]);
    const best = await dataSource
      .getRepository(UserBestLift)
      .findOneByOrFail({ userId: client.id, exerciseId: ids.squat });
    expect(best.weightKg).toBe(150);
  });

  it('409s while a program is active, and abandons it when asked', async () => {
    const first = (await enroll(client).expect(201)).body as EnrollmentView;
    const started = first.workouts[0];
    await as(client)
      .patch(
        `/workouts/${started.id}/sets/${setsOf(started, ids.squat)[0].id}`,
        { made: true },
      )
      .expect(200);

    await enroll(client).expect(409);
    const second = (await enroll(client, { abandonCurrent: true }).expect(201))
      .body as EnrollmentView;

    const old = await dataSource
      .getRepository(ProgramEnrollment)
      .findOneByOrFail({ id: first.id });
    expect(old.status).toBe('ABANDONED');
    const left = await dataSource
      .getRepository(Workout)
      .findBy({ programEnrollmentId: first.id });
    expect(left.map((w) => [w.id, w.status])).toEqual([
      [started.id, 'IN_PROGRESS'],
    ]);
    expect(second.workouts).toHaveLength(12);
  });

  it('abandons its own active enrollment only', async () => {
    const enrollment = (await enroll(client).expect(201))
      .body as EnrollmentView;
    const other = await registerAndLogin(app);
    await as(other)
      .post(`/program-enrollments/${enrollment.id}/abandon`)
      .expect(404);

    const abandoned = (
      await as(client)
        .post(`/program-enrollments/${enrollment.id}/abandon`)
        .expect(201)
    ).body as EnrollmentView;
    expect(abandoned.status).toBe('ABANDONED');
    expect(abandoned.workouts).toEqual([]);
    await as(client)
      .post(`/program-enrollments/${enrollment.id}/abandon`)
      .expect(409);
    expect(
      (await as(client).get('/program-enrollments/active').expect(200)).body,
    ).toEqual({ active: null });
  });

  it('recalculates PLANNED targets only', async () => {
    const enrollment = (await enroll(client).expect(201))
      .body as EnrollmentView;
    const started = enrollment.workouts[0];
    await as(client)
      .patch(
        `/workouts/${started.id}/sets/${setsOf(started, ids.bench)[0].id}`,
        { made: true },
      )
      .expect(200);

    const recalculated = (
      await as(client)
        .post(`/program-enrollments/${enrollment.id}/recalculate`, {
          maxes: maxes(160, 100),
        })
        .expect(201)
    ).body as EnrollmentView;

    expect(recalculated.maxesSnapshot[ids.squat]).toBe(160);
    const [first, second] = recalculated.workouts;
    expect(first.status).toBe('IN_PROGRESS');
    expect(setsOf(first, ids.squat)[0].weight).toBe(97.5);
    // 160 x 70% = 112 -> 112.5; 160 x 60% = 96 -> 95
    expect(setsOf(second, ids.squat)[0].weight).toBe(112.5);
    expect(setsOf(second, ids.pause)[0].weight).toBe(95);
    expect(setsOf(second, ids.bench)[0].weight).toBe(75);
    expect(setsOf(second, ids.row)[0].weight).toBeNull();

    await as(client)
      .post(`/program-enrollments/${enrollment.id}/recalculate`, {
        maxes: [],
      })
      .expect(400);
  });

  it('leaves no rows when enrolling fails part way', async () => {
    const service = app.get(EnrollmentService);
    const spy = jest
      .spyOn(
        service as unknown as { createWorkouts: () => Promise<void> },
        'createWorkouts',
      )
      .mockRejectedValueOnce(new Error('boom'));
    try {
      await enroll(client).expect(500);
    } finally {
      spy.mockRestore();
    }

    const where = { userId: client.id };
    expect(
      await dataSource.getRepository(ProgramEnrollment).countBy(where),
    ).toBe(0);
    expect(await dataSource.getRepository(RepMaxEntry).countBy(where)).toBe(0);
    expect(await dataSource.getRepository(UserBestLift).countBy(where)).toBe(0);
    expect(await dataSource.getRepository(Workout).countBy(where)).toBe(0);
  });
});
