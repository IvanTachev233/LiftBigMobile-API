import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Exercise } from '../workouts/entities/exercise.entity';
import {
  ProgramTemplate,
  ProgramTemplateStatus,
} from './entities/program-template.entity';
import { SportRequiredLift } from './entities/sport-required-lift.entity';
import { Sport } from './entities/sport.entity';
import { SYSTEM_ACTOR } from './program-actor';
import { ProgramService } from './program.service';
import { SAMPLE_PROGRAMS, SEED_EXERCISES, SEED_SPORTS } from './seed/seed-data';

// Serializes seeding across API instances starting at once.
const SEED_LOCK_KEY = 250001;

export interface SeedResult {
  exercises: number;
  sports: number;
  requiredLifts: number;
  programs: number;
}

// Adds the sports, their required lifts, the global exercises they use and
// one published sample program per sport. Existing rows are kept, so it can
// run on every start. Skipped when SEED_PROGRAMS=false.
@Injectable()
export class ProgramSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProgramSeeder.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly programs: ProgramService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SEED_PROGRAMS === 'false') return;
    try {
      await this.seed();
    } catch (error) {
      this.logger.error(
        'Seeding sports and programs failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async seed(): Promise<SeedResult> {
    const created: SeedResult = {
      exercises: 0,
      sports: 0,
      requiredLifts: 0,
      programs: 0,
    };
    await this.dataSource.transaction(async (lock) => {
      await lock.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_KEY]);
      const manager = this.dataSource.manager;
      const exerciseIds = await this.ensureExercises(manager, created);
      const sportIds = await this.ensureSports(manager, exerciseIds, created);
      await this.ensurePrograms(manager, sportIds, exerciseIds, created);
    });
    if (Object.values(created).some((n) => n > 0)) {
      this.logger.log(
        `Seeded ${created.sports} sports, ${created.requiredLifts} required lifts, ${created.exercises} exercises, ${created.programs} programs`,
      );
    }
    return created;
  }

  // Global exercise id by seed name. An existing global with the same name
  // in any case is reused; required lifts are made max-trackable.
  private async ensureExercises(
    manager: EntityManager,
    created: SeedResult,
  ): Promise<Map<string, string>> {
    const required = new Set(
      SEED_SPORTS.flatMap((sport) => sport.lifts.map(([, name]) => name)),
    );
    const ids = new Map<string, string>();
    for (const { name, bodyPart } of SEED_EXERCISES) {
      const isMaxTrackable = required.has(name);
      const existing = await manager
        .getRepository(Exercise)
        .createQueryBuilder('exercise')
        .where('LOWER(exercise.name) = LOWER(:name)', { name })
        .andWhere('exercise.createdById IS NULL')
        .orderBy('exercise.id')
        .getOne();
      if (existing) {
        if (isMaxTrackable && !existing.isMaxTrackable) {
          await manager.update(
            Exercise,
            { id: existing.id },
            { isMaxTrackable },
          );
        }
        ids.set(name, existing.id);
        continue;
      }
      const saved = await manager.save(
        manager.create(Exercise, {
          name,
          bodyPart,
          createdById: null,
          isMaxTrackable,
        }),
      );
      created.exercises++;
      ids.set(name, saved.id);
    }
    return ids;
  }

  // Sport id by name.
  private async ensureSports(
    manager: EntityManager,
    exerciseIds: Map<string, string>,
    created: SeedResult,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const [order, sport] of SEED_SPORTS.entries()) {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(Sport)
        .values({ name: sport.name, displayOrder: order + 1 })
        .orIgnore()
        .execute();
      created.sports += (inserted.raw as unknown[]).length;
      const { id } = await manager.findOneByOrFail(Sport, { name: sport.name });
      ids.set(sport.name, id);

      const lifts = await manager
        .createQueryBuilder()
        .insert()
        .into(SportRequiredLift)
        .values(
          sport.lifts.map(([label, exercise], i) => ({
            sportId: id,
            exerciseId: exerciseIds.get(exercise),
            label,
            displayOrder: i + 1,
          })),
        )
        .orIgnore()
        .execute();
      created.requiredLifts += (lifts.raw as unknown[]).length;
    }
    return ids;
  }

  private async ensurePrograms(
    manager: EntityManager,
    sportIds: Map<string, string>,
    exerciseIds: Map<string, string>,
    created: SeedResult,
  ): Promise<void> {
    const exerciseId = (name: string) => {
      const id = exerciseIds.get(name);
      if (!id) throw new Error(`Seed exercise "${name}" is missing`);
      return id;
    };
    for (const sample of SAMPLE_PROGRAMS) {
      let program = await manager.findOneBy(ProgramTemplate, {
        lineageId: sample.lineageId,
        version: 1,
      });
      if (!program) {
        const sportId = sportIds.get(sample.sport);
        if (!sportId)
          throw new Error(`Seed sport "${sample.sport}" is missing`);
        program = await this.programs.createDraft(
          SYSTEM_ACTOR,
          sample.build(sportId, exerciseId),
          sample.lineageId,
        );
        created.programs++;
      }
      if (program.status === ProgramTemplateStatus.DRAFT) {
        await this.programs.publish(SYSTEM_ACTOR, program.id);
      }
    }
  }
}
