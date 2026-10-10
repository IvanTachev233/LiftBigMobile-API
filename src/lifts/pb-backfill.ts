import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { lockWorkout } from '../workouts/workout-cards';
import { LiftRecordsService } from './lift-records.service';

// Serializes the backfill across API instances starting at once.
const BACKFILL_LOCK_KEY = 250003;

// Records personal bests for logged sets saved before they were recorded
// automatically: every workout with a made set on a max-trackable exercise
// is reconciled, oldest first, each in its own transaction. Reconciling is
// idempotent, so it runs on every start. Skipped when BACKFILL_PBS=false.
@Injectable()
export class PbBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(PbBackfill.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lifts: LiftRecordsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.BACKFILL_PBS === 'false') return;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        'Backfilling personal bests failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // Returns the number of entries added.
  async run(): Promise<number> {
    let added = 0;
    await this.dataSource.transaction(async (lock) => {
      await lock.query('SELECT pg_advisory_xact_lock($1)', [BACKFILL_LOCK_KEY]);
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT w.id FROM workout w
         WHERE EXISTS (
           SELECT 1 FROM workout_exercise we
           JOIN exercise e ON e.id = we."exerciseId"
           JOIN workout_set s ON s."workoutExerciseId" = we.id
           WHERE we."workoutId" = w.id AND s.made = true AND e."isMaxTrackable"
         )
         ORDER BY w.date ASC, w.id ASC`,
      );
      for (const { id } of rows) {
        added += await this.dataSource.transaction(async (manager) => {
          if (!(await lockWorkout(manager, { id }))) return 0;
          return this.lifts.reconcileWorkout(manager, id);
        });
      }
    });
    if (added > 0) this.logger.log(`Backfilled ${added} personal bests`);
    return added;
  }
}
