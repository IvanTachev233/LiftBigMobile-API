import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
} from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { User } from '../auth/user.entity';
import { addDays, todayUtc, wallClockDateOf } from '../common/calendar-date';
import { Exercise } from '../workouts/entities/exercise.entity';
import { Workout } from '../workouts/entities/workout.entity';
import {
  isExerciseVisible,
  ownerIdForVisibility,
} from '../workouts/exercise-visibility.util';
import { latestByReps } from './domain/best-lift';
import {
  MAX_PB_REPS,
  planReconcile,
  qualifyingLift,
  recomputeBest,
} from './domain/personal-best';
import { CreateRepMaxDto } from './dto/lift.dto';
import { LiftRecordSource } from './entities/lift-record-source';
import { RepMaxEntry } from './entities/rep-max-entry.entity';
import { UserBestLift } from './entities/user-best-lift.entity';

// Advisory lock class for a user's rep max entries and bests.
const RECORDS_LOCK_CLASS = 250002;

export interface NewLiftEntry {
  exerciseId: string;
  reps: number;
  weightKg: number;
  achievedOn: string;
  source: LiftRecordSource;
  workoutSetId?: string | null;
}

// Weights are stored to 2 decimals.
const roundKg = (kg: number) => Math.round(kg * 100) / 100;

// Heaviest weight to beat per rep count, null where there is none.
export type PbBars = Record<'1' | '2' | '3', number | null>;

export interface RecordedExercise {
  userId: string;
  exerciseId: string;
}

function bestView(best: UserBestLift) {
  return {
    exerciseId: best.exerciseId,
    weightKg: best.weightKg,
    unit: best.unit,
    achievedOn: best.achievedOn,
    source: best.source,
  };
}

function entryView(entry: RepMaxEntry) {
  return {
    id: entry.id,
    exerciseId: entry.exerciseId,
    reps: entry.reps,
    weightKg: entry.weightKg,
    unit: entry.unit,
    achievedOn: entry.achievedOn,
    source: entry.source,
    workoutSetId: entry.workoutSetId,
    createdAt: entry.createdAt,
  };
}

// Rep max entries and the bests derived from them. Every write of a user's
// entries holds that user's records lock until its transaction ends.
@Injectable()
export class LiftRecordsService {
  constructor(private readonly dataSource: DataSource) {}

  // Appends entries and recomputes the user's bests. Runs inside the
  // caller's transaction; the user row is locked as well.
  async append(
    manager: EntityManager,
    userId: string,
    entries: NewLiftEntry[],
  ): Promise<RepMaxEntry[]> {
    const user = await manager.findOneOrFail(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    await this.lockRecords(manager, userId);
    const saved: RepMaxEntry[] = [];
    for (const entry of entries) {
      saved.push(
        await manager.save(
          manager.create(RepMaxEntry, {
            userId,
            exerciseId: entry.exerciseId,
            reps: entry.reps,
            weightKg: roundKg(entry.weightKg),
            unit: user.weightUnit,
            achievedOn: entry.achievedOn,
            source: entry.source,
            workoutSetId: entry.workoutSetId ?? null,
          }),
        ),
      );
    }
    await this.recomputeBests(
      manager,
      userId,
      entries.map((e) => e.exerciseId),
    );
    return saved;
  }

  // Applies the personal best rules (planReconcile) to every set of the
  // workout, for its owner. recordedBefore (from
  // recordedExercises before the sets were saved) adds the exercises whose
  // entries went with deleted sets to the bests recomputed. Returns the
  // entries added.
  async reconcileWorkout(
    manager: EntityManager,
    workoutId: string,
    recordedBefore: RecordedExercise[] = [],
  ): Promise<number> {
    const workout = await manager.findOne(Workout, {
      where: { id: workoutId },
      relations: { exercises: { exercise: true, sets: true } },
    });
    if (!workout) return 0;
    const { userId } = workout;
    await this.lockRecords(manager, userId);

    const cards = [...workout.exercises].sort((a, b) => a.order - b.order);
    const setIds = cards.flatMap((card) => card.sets.map((set) => set.id));
    const linked = setIds.length
      ? await manager.findBy(RepMaxEntry, { workoutSetId: In(setIds) })
      : [];
    const touched = new Set(
      recordedBefore
        .filter((r) => r.userId === userId)
        .map((r) => r.exerciseId),
    );
    const exerciseIds = [
      ...new Set([
        ...touched,
        ...cards
          .filter((card) => card.exercise.isMaxTrackable)
          .map((card) => card.exerciseId),
        ...linked.map((entry) => entry.exerciseId),
      ]),
    ];
    if (exerciseIds.length === 0) return 0;

    const entries = await manager.findBy(RepMaxEntry, {
      userId,
      exerciseId: In(exerciseIds),
    });
    const user = await manager.findOneByOrFail(User, { id: userId });
    const sets = cards.flatMap((card) =>
      [...card.sets]
        .sort((a, b) => a.order - b.order)
        .map((set) => ({
          setId: set.id,
          exerciseId: card.exerciseId,
          lift: qualifyingLift(set, card.exercise.isMaxTrackable),
        })),
    );
    let added = 0;

    for (const action of planReconcile(
      sets,
      entries,
      wallClockDateOf(workout.date),
    )) {
      touched.add(action.exerciseId);
      if (action.type === 'delete') {
        await manager.delete(RepMaxEntry, { id: action.entryId });
        continue;
      }
      const values = {
        reps: action.reps,
        weightKg: roundKg(action.weightKg),
        achievedOn: action.achievedOn,
      };
      if (action.type === 'follow') {
        await manager.update(RepMaxEntry, { id: action.entryId }, values);
        continue;
      }
      await manager.insert(RepMaxEntry, {
        userId,
        exerciseId: action.exerciseId,
        ...values,
        unit: user.weightUnit,
        source: LiftRecordSource.LOGGED_SET,
        workoutSetId: action.setId,
      });
      added++;
    }
    await this.recomputeBests(manager, userId, touched);
    return added;
  }

  // Users and exercises with entries linked to sets of the matching
  // workouts; call before deleting them, then recomputeAfterDelete.
  async recordedExercises(
    manager: EntityManager,
    where: FindOptionsWhere<Workout>,
  ): Promise<RecordedExercise[]> {
    const entries = await manager.find(RepMaxEntry, {
      select: { userId: true, exerciseId: true },
      where: { workoutSet: { workoutExercise: { workout: where } } },
    });
    const seen = new Map(
      entries.map((e) => [`${e.userId}:${e.exerciseId}`, e]),
    );
    return [...seen.values()].map(({ userId, exerciseId }) => ({
      userId,
      exerciseId,
    }));
  }

  // Recomputes the bests whose entries went with deleted sets.
  async recomputeAfterDelete(
    manager: EntityManager,
    recorded: RecordedExercise[],
  ): Promise<void> {
    for (const userId of new Set(recorded.map((r) => r.userId))) {
      await this.lockRecords(manager, userId);
      await this.recomputeBests(
        manager,
        userId,
        recorded.filter((r) => r.userId === userId).map((r) => r.exerciseId),
      );
    }
  }

  // Ids of the given sets that have a non-removed entry.
  async pbSetIds(
    manager: EntityManager,
    setIds: string[],
  ): Promise<Set<string>> {
    if (setIds.length === 0) return new Set();
    const entries = await manager.find(RepMaxEntry, {
      select: { workoutSetId: true },
      where: { workoutSetId: In(setIds), removedAt: IsNull() },
    });
    return new Set(entries.map((e) => e.workoutSetId!));
  }

  // Per exercise, the heaviest non-removed 1-3 rep entries of the user
  // dated on or before achievedOn, leaving out entries linked to
  // excludeSetIds (the sets of the workout being viewed).
  async pbBars(
    manager: EntityManager,
    userId: string,
    exerciseIds: string[],
    achievedOn: string,
    excludeSetIds: string[],
  ): Promise<Map<string, PbBars>> {
    const bars = new Map<string, PbBars>(
      exerciseIds.map((id) => [id, { 1: null, 2: null, 3: null }]),
    );
    if (exerciseIds.length === 0) return bars;
    const query = manager
      .createQueryBuilder(RepMaxEntry, 'entry')
      .select('entry.exerciseId', 'exerciseId')
      .addSelect('entry.reps', 'reps')
      .addSelect('MAX(entry.weightKg)', 'weightKg')
      .where('entry.userId = :userId', { userId })
      .andWhere('entry.exerciseId IN (:...exerciseIds)', { exerciseIds })
      .andWhere('entry.reps BETWEEN 1 AND :maxReps', { maxReps: MAX_PB_REPS })
      .andWhere('entry.removedAt IS NULL')
      .andWhere('entry.achievedOn <= :achievedOn', { achievedOn })
      .groupBy('entry.exerciseId')
      .addGroupBy('entry.reps');
    if (excludeSetIds.length > 0) {
      query.andWhere(
        '(entry.workoutSetId IS NULL OR entry.workoutSetId NOT IN (:...excludeSetIds))',
        { excludeSetIds },
      );
    }
    const rows = await query.getRawMany<{
      exerciseId: string;
      reps: number;
      weightKg: string;
    }>();
    for (const row of rows) {
      const bar = bars.get(row.exerciseId);
      if (bar)
        bar[String(row.reps) as keyof PbBars] = roundKg(Number(row.weightKg));
    }
    return bars;
  }

  // Marks an own entry removed and recomputes the best.
  async remove(user: AuthUser, id: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.lockRecords(manager, user.id);
      const entry = await manager.findOneBy(RepMaxEntry, {
        id,
        userId: user.id,
        removedAt: IsNull(),
      });
      if (!entry) throw new NotFoundException(`Rep max "${id}" not found`);
      entry.removedAt = new Date();
      await manager.update(RepMaxEntry, { id }, { removedAt: entry.removedAt });
      await this.recomputeBests(manager, user.id, [entry.exerciseId]);
      return this.withBest(manager, entry);
    });
  }

  // The caller holds the records lock.
  private async recomputeBests(
    manager: EntityManager,
    userId: string,
    exerciseIds: Iterable<string>,
  ): Promise<void> {
    for (const exerciseId of new Set(exerciseIds)) {
      const entries = await manager.findBy(RepMaxEntry, {
        userId,
        exerciseId,
        reps: 1,
        removedAt: IsNull(),
      });
      const top = recomputeBest(entries);
      const current = await manager.findOneBy(UserBestLift, {
        userId,
        exerciseId,
      });
      if (!top) {
        if (current) await manager.delete(UserBestLift, { id: current.id });
        continue;
      }
      await manager.save(
        manager.create(UserBestLift, {
          ...(current ?? { userId, exerciseId }),
          weightKg: top.weightKg,
          unit: top.unit,
          achievedOn: top.achievedOn,
          source: top.source,
        }),
      );
    }
  }

  private async lockRecords(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      RECORDS_LOCK_CLASS,
      userId,
    ]);
  }

  async bests(user: AuthUser, exerciseIds?: string[]) {
    const bests = await this.dataSource.getRepository(UserBestLift).find({
      where: {
        userId: user.id,
        ...(exerciseIds ? { exerciseId: In(exerciseIds) } : {}),
      },
    });
    return bests.map(bestView);
  }

  async history(user: AuthUser, exerciseId: string) {
    const visible = await isExerciseVisible(
      this.dataSource.getRepository(Exercise),
      exerciseId,
      ownerIdForVisibility(user),
    );
    if (!visible) {
      throw new NotFoundException(`Exercise "${exerciseId}" not found`);
    }
    const [best, entries] = await Promise.all([
      this.dataSource
        .getRepository(UserBestLift)
        .findOneBy({ userId: user.id, exerciseId }),
      this.dataSource.getRepository(RepMaxEntry).find({
        where: { userId: user.id, exerciseId, removedAt: IsNull() },
        order: { achievedOn: 'ASC', createdAt: 'ASC', seq: 'ASC' },
      }),
    ]);
    return {
      exerciseId,
      best: best ? bestView(best) : null,
      latest: latestByReps(entries, [1, 2, 3]).map(({ reps, entry }) => ({
        reps,
        entry: entry ? entryView(entry) : null,
      })),
      entries: entries.map(entryView),
    };
  }

  async recordManual(user: AuthUser, dto: CreateRepMaxDto) {
    // One day of slack for clients ahead of UTC.
    if (dto.achievedOn > addDays(todayUtc(), 1)) {
      throw new BadRequestException('achievedOn cannot be in the future');
    }
    const visible = await isExerciseVisible(
      this.dataSource.getRepository(Exercise),
      dto.exerciseId,
      ownerIdForVisibility(user),
    );
    if (!visible) {
      throw new BadRequestException(`Unknown exercise "${dto.exerciseId}"`);
    }
    return this.dataSource.transaction(async (manager) => {
      const [entry] = await this.append(manager, user.id, [
        { ...dto, source: LiftRecordSource.MANUAL },
      ]);
      return this.withBest(manager, entry);
    });
  }

  private async withBest(manager: EntityManager, entry: RepMaxEntry) {
    const best = await manager.findOneBy(UserBestLift, {
      userId: entry.userId,
      exerciseId: entry.exerciseId,
    });
    return { entry: entryView(entry), best: best ? bestView(best) : null };
  }
}
