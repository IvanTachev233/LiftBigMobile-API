import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { ProgramSeeder } from '../src/programs/program-seeder';
import { createE2eApp, registerAndLogin } from './e2e-app';

type Tags = Pick<Exercise, 'category' | 'equipment'>;

const tagsOf = async (repo: Repository<Exercise>) =>
  Object.fromEntries(
    (await repo.find({ where: { createdById: IsNull() } })).map((e) => [
      e.name,
      { category: e.category, equipment: e.equipment },
    ]),
  ) as Record<string, Tags>;

describe('Exercise categories (e2e)', () => {
  const seedSetting = process.env.SEED_PROGRAMS;

  afterEach(() => {
    if (seedSetting === undefined) delete process.env.SEED_PROGRAMS;
    else process.env.SEED_PROGRAMS = seedSetting;
  });

  describe('on a fresh database', () => {
    let app: INestApplication<App>;
    let repo: Repository<Exercise>;

    beforeAll(async () => {
      delete process.env.SEED_PROGRAMS;
      app = await createE2eApp();
      repo = app.get(DataSource).getRepository(Exercise);
    });

    afterAll(async () => {
      await app.close();
    });

    it('gives every seeded global a category and equipment', async () => {
      const tags = await tagsOf(repo);
      expect(Object.keys(tags).length).toBeGreaterThan(0);
      expect(tags).toMatchObject({
        'Back Squat': { category: 'Squat', equipment: 'Barbell' },
        'Pause Squat': { category: 'Squat', equipment: 'Barbell' },
        Clean: { category: 'Olympic', equipment: 'Barbell' },
        'Clean Pull': { category: 'Olympic', equipment: 'Barbell' },
        'Push Press': { category: 'Press', equipment: 'Barbell' },
        'Bench Press': { category: 'Press', equipment: 'Barbell' },
        Deadlift: { category: 'Pull', equipment: 'Barbell' },
        'Barbell Row': { category: 'Pull', equipment: 'Barbell' },
      });
      for (const [name, t] of Object.entries(tags)) {
        expect([name, t.category, t.equipment]).toEqual([
          name,
          expect.any(String),
          expect.any(String),
        ]);
      }
    });

    it('lists the category and equipment with each exercise; a coach-made one has none', async () => {
      const coach = await registerAndLogin(app, 'COACH');
      const created = await request(app.getHttpServer())
        .post('/workouts/exercises')
        .set('Authorization', `Bearer ${coach.token}`)
        .send({ name: 'Sled Push', equipment: 'Sled' })
        .expect(201);
      expect(created.body).toMatchObject({ category: null, equipment: null });

      const list = (
        await request(app.getHttpServer())
          .get('/workouts/exercises')
          .set('Authorization', `Bearer ${coach.token}`)
          .expect(200)
      ).body as (Exercise & Tags)[];
      expect(list.find((e) => e.name === 'Front Squat')).toMatchObject({
        category: 'Squat',
        equipment: 'Barbell',
      });
      expect(list.find((e) => e.name === 'Sled Push')).toMatchObject({
        category: null,
        equipment: null,
      });
    });

    it('lets a coach give an own exercise one of the categories', async () => {
      const coach = await registerAndLogin(app, 'COACH');
      const post = (body: object) =>
        request(app.getHttpServer())
          .post('/workouts/exercises')
          .set('Authorization', `Bearer ${coach.token}`)
          .send(body);
      const res = await post({
        name: 'Zercher Squat',
        category: 'Squat',
      }).expect(201);
      expect(res.body).toMatchObject({ category: 'Squat', equipment: null });
      await post({ name: 'Cleanless', category: null }).expect(201);
      for (const category of ['Cardio', 'squat', '', 7]) {
        await post({ name: `Bad ${String(category)}`, category }).expect(400);
      }
      const stored = await repo.findOneByOrFail({
        id: (res.body as Exercise).id,
      });
      expect(stored.category).toBe('Squat');
    });

    it('changes nothing on a second run', async () => {
      const before = await tagsOf(repo);
      const result = await app.get(ProgramSeeder).seed();
      expect(result.tagged).toBe(0);
      expect(await tagsOf(repo)).toEqual(before);
    });
  });

  it('fills globals that exist without them, whatever their case, and keeps set values', async () => {
    process.env.SEED_PROGRAMS = 'false';
    const app = await createE2eApp();
    try {
      const dataSource = app.get(DataSource);
      const repo = dataSource.getRepository(Exercise);
      const older = await repo.save({
        name: 'POWER CLEAN AND JERK',
        createdById: null,
      });
      const bench = await repo.save({ name: 'bench press', createdById: null });
      const kept = await repo.save({
        name: 'Deadlift',
        createdById: null,
        category: 'Squat',
      });
      const coach = await registerAndLogin(app, 'COACH');
      const own = await repo.save({
        name: 'Back Squat',
        createdById: coach.id,
      });

      const first = await app.get(ProgramSeeder).seed();
      expect(first.tagged).toBeGreaterThan(0);

      const byId = (id: string) => repo.findOneByOrFail({ id });
      expect(await byId(older.id)).toMatchObject({
        category: 'Olympic',
        equipment: 'Barbell',
      });
      expect(await byId(bench.id)).toMatchObject({
        category: 'Press',
        equipment: 'Barbell',
      });
      expect(await byId(kept.id)).toMatchObject({
        category: 'Squat',
        equipment: 'Barbell',
      });
      expect(await byId(own.id)).toMatchObject({
        category: null,
        equipment: null,
      });

      const before = await tagsOf(repo);
      expect((await app.get(ProgramSeeder).seed()).tagged).toBe(0);
      expect(await tagsOf(repo)).toEqual(before);
    } finally {
      await app.close();
    }
  });
});
