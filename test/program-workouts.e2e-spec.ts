import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { addDays, todayUtc } from '../src/common/calendar-date';
import { ProgramEnrollment } from '../src/programs/entities/program-enrollment.entity';
import { SYSTEM_ACTOR } from '../src/programs/program-actor';
import { ProgramService } from '../src/programs/program.service';
import { Workout } from '../src/workouts/entities/workout.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';
import { createSportWithExercises } from './e2e-fixtures';

interface WorkoutView {
  id: string;
  status: string;
  source: string;
  program: { enrollmentId: string; name: string } | null;
  exercises: { id: string; exerciseId: string; sets: { id: string }[] }[];
}

interface EnrollmentView {
  id: string;
  workouts: WorkoutView[];
}

describe('Program workouts in the workout API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let programId: string;
  let squatId: string;
  let client: E2eUser;
  let enrollment: EnrollmentView;

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${client.token}`);

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    const { sport, exercises } = await createSportWithExercises(
      dataSource,
      ['Squat'],
      1,
    );
    squatId = exercises.Squat.id;
    const programs = app.get(ProgramService);
    const draft = await programs.createDraft(SYSTEM_ACTOR, {
      sportId: sport.id,
      name: 'Two Sessions',
      durationWeeks: 1,
      sessionsPerWeek: 2,
      sessions: [0, 3].map((dayOffset, i) => ({
        week: 1,
        sessionIndex: i + 1,
        dayOffset,
        title: `Day ${i + 1}`,
        exercises: [
          {
            exerciseId: squatId,
            sets: 2,
            reps: 5,
            percentOf1RM: 70,
            referenceExerciseId: squatId,
          },
        ],
      })),
    });
    programId = (await programs.publish(SYSTEM_ACTOR, draft.id)).id;
  });

  beforeEach(async () => {
    client = await registerAndLogin(app);
    enrollment = (
      await call('post', '/program-enrollments')
        .send({
          programId,
          startDate: addDays(todayUtc(), 1),
          maxes: [{ exerciseId: squatId, weightKg: 100 }],
        })
        .expect(201)
    ).body as EnrollmentView;
  });

  afterAll(async () => {
    await app.close();
  });

  it('locks the plan of a program workout but lets the user log it', async () => {
    const workout = enrollment.workouts[0];
    const card = workout.exercises[0];
    const path = `/workouts/${workout.id}`;

    await call('patch', path).send({ name: 'Renamed' }).expect(403);
    await call('patch', path).send({ date: '2030-01-01' }).expect(403);
    await call('patch', path)
      .send({
        exercises: [
          { exerciseId: squatId, order: 1, sets: [{ reps: 1, weight: 1 }] },
        ],
      })
      .expect(403);
    await call('delete', path).expect(403);

    await call('patch', `${path}/sets/${card.sets[0].id}`)
      .send({ made: true, actualReps: 5 })
      .expect(200);
    await call('post', `${path}/cards/${card.id}/sets`)
      .send({ reps: 3, weight: 60 })
      .expect(201);
    await call('patch', path).send({ status: 'IN_PROGRESS' }).expect(200);

    const after = (await call('get', path).expect(200)).body as WorkoutView;
    expect(after.exercises[0].sets).toHaveLength(3);
    expect(after.status).toBe('IN_PROGRESS');
  });

  it('shows the source of manual, coach and program workouts', async () => {
    const manual = (
      await call('post', '/workouts')
        .send({ name: 'Manual', date: '2030-01-01' })
        .expect(201)
    ).body as { id: string };
    const coach = await registerAndLogin(app, 'COACH');
    const assigned = await dataSource.getRepository(Workout).save({
      userId: client.id,
      assignedById: coach.id,
      name: 'Assigned',
      date: new Date('2030-01-02'),
    });

    const view = async (id: string) =>
      (await call('get', `/workouts/${id}`).expect(200)).body as WorkoutView;
    expect(await view(manual.id)).toMatchObject({
      source: 'manual',
      program: null,
    });
    expect(await view(assigned.id)).toMatchObject({
      source: 'coach',
      program: null,
    });
    expect(await view(enrollment.workouts[0].id)).toMatchObject({
      source: 'program',
      program: { enrollmentId: enrollment.id, name: 'Two Sessions' },
    });

    const list = (await call('get', '/workouts').expect(200))
      .body as WorkoutView[];
    expect(list.map((w) => w.source).sort()).toEqual([
      'coach',
      'manual',
      'program',
      'program',
    ]);
    const upcoming = (await call('get', '/workouts/upcoming').expect(200))
      .body as WorkoutView[];
    expect(upcoming.filter((w) => w.source === 'program')).toHaveLength(2);
    expect(enrollment.workouts[0].source).toBe('program');
  });

  it('completes the enrollment only after its last workout', async () => {
    const status = async () =>
      (
        await dataSource
          .getRepository(ProgramEnrollment)
          .findOneByOrFail({ id: enrollment.id })
      ).status;
    const [first, second] = enrollment.workouts;

    await call('patch', `/workouts/${first.id}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect(await status()).toBe('ACTIVE');

    await call('patch', `/workouts/${second.id}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect(await status()).toBe('COMPLETED');
    expect(
      (await call('get', '/program-enrollments/active').expect(200)).body,
    ).toEqual({ active: null });
  });
});
