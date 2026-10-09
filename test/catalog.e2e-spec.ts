import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { ProgramTemplate } from '../src/programs/entities/program-template.entity';
import { SportRequiredLift } from '../src/programs/entities/sport-required-lift.entity';
import { Sport } from '../src/programs/entities/sport.entity';
import { SYSTEM_ACTOR } from '../src/programs/program-actor';
import { ProgramService } from '../src/programs/program.service';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';

interface SportView {
  id: string;
  name: string;
  requiredLifts: { exerciseId: string; label: string; exerciseName: string }[];
}

interface ProgramDetail {
  id: string;
  name: string;
  authorName: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  sport: { id: string; name: string };
  referenceLifts: { exerciseId: string; label: string }[];
  sessions: {
    week: number;
    sessionIndex: number;
    dayOffset: number;
    title: string;
    exercises: {
      exerciseName: string;
      sets: number;
      reps: number;
      percentOf1RM: number | null;
      referenceLabel: string | null;
    }[];
  }[];
}

const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000';

describe('Catalog (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let client: E2eUser;
  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${client.token}`);

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    client = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const sportNamed = async (name: string) => {
    const sports = (await get('/sports').expect(200)).body as SportView[];
    return sports.find((s) => s.name === name)!;
  };

  it('needs a login for every route', async () => {
    const server = app.getHttpServer();
    await request(server).get('/sports').expect(401);
    await request(server).get(`/sports/${NO_SUCH_ID}/programs`).expect(401);
    await request(server).get(`/programs/${NO_SUCH_ID}`).expect(401);
  });

  it('lists sports in display order with their labelled required lifts', async () => {
    const sports = (await get('/sports').expect(200)).body as SportView[];
    expect(sports.map((s) => s.name)).toEqual([
      'Olympic Weightlifting',
      'Powerlifting',
    ]);
    expect(
      sports[1].requiredLifts.map((l) => [l.label, l.exerciseName]),
    ).toEqual([
      ['Squat', 'Back Squat'],
      ['Bench Press', 'Bench Press'],
      ['Deadlift', 'Deadlift'],
    ]);
    expect(sports[0].requiredLifts).toHaveLength(10);
  });

  it('shows a sport added as data with no code change', async () => {
    const sport = await dataSource
      .getRepository(Sport)
      .save({ name: 'Strongman', displayOrder: 3 });
    const exercise = await dataSource
      .getRepository(Exercise)
      .save({ name: 'Log Press', createdById: null, isMaxTrackable: true });
    await dataSource.getRepository(SportRequiredLift).save({
      sportId: sport.id,
      exerciseId: exercise.id,
      label: 'Log',
      displayOrder: 1,
    });

    const sports = (await get('/sports').expect(200)).body as SportView[];
    expect(sports.map((s) => s.name)).toEqual([
      'Olympic Weightlifting',
      'Powerlifting',
      'Strongman',
    ]);
    expect(sports[2].requiredLifts).toMatchObject([
      { label: 'Log', exerciseName: 'Log Press' },
    ]);
    await get(`/sports/${sport.id}/programs`).expect(200).expect([]);
  });

  it('lists only PUBLISHED programs of a sport', async () => {
    const powerlifting = await sportNamed('Powerlifting');
    const programs = app.get(ProgramService);
    const published = await dataSource
      .getRepository(ProgramTemplate)
      .findOneByOrFail({ sportId: powerlifting.id });
    // A draft and an archived version of the seeded program.
    const v2 = await programs.revise(SYSTEM_ACTOR, published.id);
    const draft = await programs.createDraft(SYSTEM_ACTOR, {
      sportId: powerlifting.id,
      name: 'Draft only',
      durationWeeks: 1,
      sessionsPerWeek: 1,
      sessions: [],
    });

    const listed = (
      await get(`/sports/${powerlifting.id}/programs`).expect(200)
    ).body as ProgramDetail[];
    expect(listed).toEqual([
      {
        id: published.id,
        name: 'Sample Powerlifting Program',
        description: published.description,
        authorName: 'LiftBig',
        durationWeeks: 4,
        sessionsPerWeek: 3,
      },
    ]);
    await get(`/programs/${draft.id}`).expect(404);
    await get(`/programs/${v2.id}`).expect(404);

    await programs.publish(SYSTEM_ACTOR, v2.id);
    const afterPublish = (
      await get(`/sports/${powerlifting.id}/programs`).expect(200)
    ).body as ProgramDetail[];
    expect(afterPublish.map((p) => p.id)).toEqual([v2.id]);
    await get(`/programs/${published.id}`).expect(404);
  });

  it('returns a published program with its sessions for preview', async () => {
    const weightlifting = await sportNamed('Olympic Weightlifting');
    const [summary] = (
      await get(`/sports/${weightlifting.id}/programs`).expect(200)
    ).body as ProgramDetail[];

    const program = (await get(`/programs/${summary.id}`).expect(200))
      .body as ProgramDetail;
    expect(program).toMatchObject({
      name: 'Sample Weightlifting Program',
      authorName: 'LiftBig',
      sport: { id: weightlifting.id, name: 'Olympic Weightlifting' },
    });
    expect(program.sessions).toHaveLength(12);
    expect(
      program.sessions.map((s) => [s.week, s.sessionIndex, s.dayOffset]),
    ).toEqual(
      [1, 2, 3, 4].flatMap((week) => [
        [week, 1, 0],
        [week, 2, 2],
        [week, 3, 4],
      ]),
    );
    expect(program.sessions[0].exercises[1]).toMatchObject({
      exerciseName: 'Snatch Pull',
      sets: 3,
      reps: 3,
      percentOf1RM: 90,
      referenceLabel: 'Snatch',
    });
    expect(program.referenceLifts.map((l) => l.label)).toEqual([
      'Back Squat',
      'Front Squat',
      'Clean',
      'Clean & Jerk',
      'Power Clean',
      'Snatch',
      'Power Snatch',
      'Push Press',
    ]);
  });

  it('404s on unknown ids and 400s on malformed ones', async () => {
    await get(`/sports/${NO_SUCH_ID}/programs`).expect(404);
    await get(`/programs/${NO_SUCH_ID}`).expect(404);
    await get('/programs/not-a-uuid').expect(400);
  });
});
