import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { validateProgram } from '../src/programs/domain/validation';
import { ProgramTemplateExercise } from '../src/programs/entities/program-template-exercise.entity';
import { ProgramTemplateSession } from '../src/programs/entities/program-template-session.entity';
import {
  ProgramTemplate,
  ProgramTemplateStatus,
} from '../src/programs/entities/program-template.entity';
import { SportRequiredLift } from '../src/programs/entities/sport-required-lift.entity';
import { Sport } from '../src/programs/entities/sport.entity';
import { ProgramSeeder } from '../src/programs/program-seeder';
import { createE2eApp } from './e2e-app';

async function counts(dataSource: DataSource) {
  return {
    sports: await dataSource.getRepository(Sport).count(),
    requiredLifts: await dataSource.getRepository(SportRequiredLift).count(),
    exercises: await dataSource.getRepository(Exercise).count(),
    programs: await dataSource.getRepository(ProgramTemplate).count(),
    published: await dataSource
      .getRepository(ProgramTemplate)
      .countBy({ status: ProgramTemplateStatus.PUBLISHED }),
    sessions: await dataSource.getRepository(ProgramTemplateSession).count(),
    programExercises: await dataSource
      .getRepository(ProgramTemplateExercise)
      .count(),
  };
}

describe('ProgramSeeder (e2e)', () => {
  const seedSetting = process.env.SEED_PROGRAMS;

  afterEach(() => {
    if (seedSetting === undefined) delete process.env.SEED_PROGRAMS;
    else process.env.SEED_PROGRAMS = seedSetting;
  });

  describe('on a fresh database', () => {
    let app: INestApplication<App>;
    let dataSource: DataSource;

    beforeAll(async () => {
      delete process.env.SEED_PROGRAMS;
      app = await createE2eApp();
      dataSource = app.get(DataSource);
    });

    afterAll(async () => {
      await app.close();
    });

    it('seeds both sports with their required lifts and labels', async () => {
      const sports = await dataSource.getRepository(Sport).find({
        relations: { requiredLifts: { exercise: true } },
        order: { displayOrder: 'ASC', requiredLifts: { displayOrder: 'ASC' } },
      });
      expect(
        sports.map((s) => ({
          name: s.name,
          lifts: s.requiredLifts.map((l) => [l.label, l.exercise.name]),
        })),
      ).toEqual([
        {
          name: 'Olympic Weightlifting',
          lifts: [
            ['Back Squat', 'Back Squat'],
            ['Front Squat', 'Front Squat'],
            ['Clean', 'Clean'],
            ['Jerk', 'Jerk'],
            ['Clean & Jerk', 'Clean and Jerk'],
            ['Power Clean', 'Power Clean'],
            ['Power Jerk', 'Power Jerk'],
            ['Snatch', 'Snatch'],
            ['Power Snatch', 'Power Snatch'],
            ['Push Press', 'Push Press'],
          ],
        },
        {
          name: 'Powerlifting',
          lifts: [
            ['Squat', 'Back Squat'],
            ['Bench Press', 'Bench Press'],
            ['Deadlift', 'Deadlift'],
          ],
        },
      ]);
      const lifts = sports.flatMap((s) => s.requiredLifts);
      expect(lifts.every((l) => l.exercise.isMaxTrackable)).toBe(true);
      expect(lifts.every((l) => l.exercise.createdById === null)).toBe(true);
    });

    it('publishes one valid sample program per sport, by the system', async () => {
      const programs = await dataSource.getRepository(ProgramTemplate).find({
        relations: { sessions: { exercises: true }, sport: true },
        order: { sport: { displayOrder: 'ASC' } },
      });
      expect(programs.map((p) => [p.sport.name, p.status, p.authorId])).toEqual(
        [
          ['Olympic Weightlifting', ProgramTemplateStatus.PUBLISHED, null],
          ['Powerlifting', ProgramTemplateStatus.PUBLISHED, null],
        ],
      );
      const exercises = await dataSource
        .getRepository(Exercise)
        .find({ select: { id: true } });
      for (const program of programs) {
        expect(program.name).toMatch(/^Sample/);
        const sport = await dataSource.getRepository(Sport).findOneOrFail({
          where: { id: program.sportId },
          relations: { requiredLifts: true },
        });
        expect(validateProgram(program, sport, exercises)).toEqual([]);
        const crossReferenced = program.sessions
          .flatMap((s) => s.exercises)
          .filter(
            (e) =>
              e.referenceExerciseId !== null &&
              e.referenceExerciseId !== e.exerciseId,
          );
        expect(crossReferenced.length).toBeGreaterThan(0);
      }
    });

    it('inserts nothing on a second run', async () => {
      const before = await counts(dataSource);
      expect(before).toMatchObject({
        sports: 2,
        requiredLifts: 13,
        published: 2,
      });
      await app.get(ProgramSeeder).seed();
      expect(await counts(dataSource)).toEqual(before);
    });
  });

  it('reuses existing global exercises whatever their case', async () => {
    process.env.SEED_PROGRAMS = 'false';
    const app = await createE2eApp();
    try {
      const dataSource = app.get(DataSource);
      expect(await dataSource.getRepository(Sport).count()).toBe(0);
      const repo = dataSource.getRepository(Exercise);
      const bench = await repo.save({ name: 'bench press', createdById: null });
      await repo.save({ name: 'PAUSE SQUAT', createdById: null });

      await app.get(ProgramSeeder).seed();

      const sameName = (name: string) =>
        repo
          .createQueryBuilder('e')
          .where('LOWER(e.name) = LOWER(:name)', { name })
          .andWhere('e.createdById IS NULL')
          .getCount();
      expect(await sameName('Bench Press')).toBe(1);
      expect(await sameName('Pause Squat')).toBe(1);
      expect(await repo.findOneByOrFail({ id: bench.id })).toMatchObject({
        name: 'bench press',
        isMaxTrackable: true,
      });
      const lift = await dataSource
        .getRepository(SportRequiredLift)
        .findOneByOrFail({ label: 'Bench Press' });
      expect(lift.exerciseId).toBe(bench.id);
    } finally {
      await app.close();
    }
  });

  it('gives the same rows when the API starts twice on one database', async () => {
    const first = await createE2eApp();
    const afterFirst = await counts(first.get(DataSource));
    await first.close();

    const second = await createE2eApp({ dropSchema: false });
    try {
      const afterSecond = await counts(second.get(DataSource));
      expect(afterSecond).toEqual(afterFirst);
      expect(afterSecond).toMatchObject({
        sports: 2,
        requiredLifts: 13,
        programs: 2,
        published: 2,
      });
    } finally {
      await second.close();
    }
  });
});
