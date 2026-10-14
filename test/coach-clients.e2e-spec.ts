import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { User } from '../src/auth/user.entity';
import {
  Workout,
  WorkoutStatus,
} from '../src/workouts/entities/workout.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface ClientSummary {
  id: string;
  name: string | null;
  email: string;
  role: string;
  assignedCount: number;
  completedCount: number;
  lastWorkout: { date: string; name: string } | null;
}

describe('Coach client summary (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let coach: E2eUser;

  const clients = async (user = coach) =>
    (
      await request(app.getHttpServer())
        .get('/auth/clients')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200)
    ).body as ClientSummary[];

  const clientOf = async (owner: E2eUser) => {
    const client = await registerAndLogin(app);
    await dataSource
      .getRepository(User)
      .update({ id: client.id }, { coachId: owner.id });
    return client;
  };

  const addWorkout = (
    client: E2eUser,
    name: string,
    date: string,
    status: WorkoutStatus,
    assignedBy: E2eUser | null = coach,
    startedAt: Date | null = null,
  ) =>
    dataSource.getRepository(Workout).insert({
      userId: client.id,
      assignedById: assignedBy?.id ?? null,
      name,
      date: new Date(date),
      status,
      startedAt,
    });

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    coach = await registerAndLogin(app, 'COACH');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts only the workouts this coach assigned and names the last one started', async () => {
    const otherCoach = await registerAndLogin(app, 'COACH');
    const client = await clientOf(coach);
    const idle = await clientOf(coach);
    await clientOf(otherCoach);

    await addWorkout(client, 'Day 4', '2026-10-01', WorkoutStatus.COMPLETED);
    await addWorkout(client, 'Day 1', '2026-10-05', WorkoutStatus.COMPLETED);
    await addWorkout(client, 'Day 2', '2026-10-07', WorkoutStatus.IN_PROGRESS);
    await addWorkout(client, 'Day 3', '2026-10-09', WorkoutStatus.PLANNED);
    // Newer, but not assigned by this coach
    await addWorkout(
      client,
      'Own',
      '2026-10-10',
      WorkoutStatus.COMPLETED,
      null,
    );
    await addWorkout(
      client,
      'Old coach',
      '2026-10-11',
      WorkoutStatus.COMPLETED,
      otherCoach,
    );

    const list = await clients();
    expect(list).toHaveLength(2);
    const byId = new Map(list.map((c) => [c.id, c]));
    expect(byId.get(client.id)).toEqual({
      id: client.id,
      name: 'E2E User',
      email: client.email,
      role: 'CLIENT',
      assignedCount: 4,
      completedCount: 2,
      lastWorkout: { date: '2026-10-07T00:00:00.000Z', name: 'Day 2' },
    });
    expect(byId.get(idle.id)).toEqual({
      id: idle.id,
      name: 'E2E User',
      email: idle.email,
      role: 'CLIENT',
      assignedCount: 0,
      completedCount: 0,
      lastWorkout: null,
    });
  });

  it('takes the later start when two started workouts share a date', async () => {
    const client = await clientOf(coach);
    await addWorkout(
      client,
      'Morning',
      '2026-10-07',
      WorkoutStatus.COMPLETED,
      coach,
      new Date('2026-10-07T07:00:00Z'),
    );
    await addWorkout(
      client,
      'Evening',
      '2026-10-07',
      WorkoutStatus.IN_PROGRESS,
      coach,
      new Date('2026-10-07T18:00:00Z'),
    );
    await addWorkout(client, 'No start', '2026-10-07', WorkoutStatus.COMPLETED);

    const [summary] = await clients();
    expect(summary.lastWorkout).toEqual({
      date: '2026-10-07T00:00:00.000Z',
      name: 'Evening',
    });
  });

  it('reads every client in one query', async () => {
    const spy = jest.spyOn(PostgresQueryRunner.prototype, 'query');
    // The token check reads the caller's token version on every request
    const queries = {
      mockClear: () => spy.mockClear(),
      calls: () =>
        spy.mock.calls.filter(
          ([sql]) => !String(sql).includes('"tokenVersion"'),
        ),
    };
    const first = await clientOf(coach);
    await addWorkout(first, 'Day 1', '2026-10-05', WorkoutStatus.COMPLETED);

    queries.mockClear();
    await clients();
    expect(queries.calls()).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      const client = await clientOf(coach);
      await addWorkout(client, 'Day 1', '2026-10-05', WorkoutStatus.COMPLETED);
      await addWorkout(client, 'Day 2', '2026-10-06', WorkoutStatus.PLANNED);
    }
    queries.mockClear();
    expect(await clients()).toHaveLength(4);
    expect(queries.calls()).toHaveLength(1);
  });

  it('is for coaches only', async () => {
    const client = await clientOf(coach);
    await request(app.getHttpServer())
      .get('/auth/clients')
      .set('Authorization', `Bearer ${client.token}`)
      .expect(403);
  });
});
