import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { User } from '../auth/user.entity';
import { addDays, dateOf, todayUtc } from '../common/calendar-date';
import { Exercise } from '../workouts/entities/exercise.entity';
import { WorkoutSet } from '../workouts/entities/workout-set.entity';
import {
  isExerciseVisible,
  ownerIdForVisibility,
} from '../workouts/exercise-visibility.util';
import { latestByReps, nextBest } from './domain/best-lift';
import { CreateRepMaxDto } from './dto/lift.dto';
import { LiftRecordSource } from './entities/lift-record-source';
import { RepMaxEntry } from './entities/rep-max-entry.entity';
import { UserBestLift } from './entities/user-best-lift.entity';

const UNIQUE_VIOLATION = '23505';
const MAX_REP_MAX_REPS = 3;

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

// Rep max entries are only appended; each append may raise the user's best.
@Injectable()
export class LiftRecordsService {
  constructor(private readonly dataSource: DataSource) {}

  // Appends entries and raises the user's bests. Runs inside the caller's
  // transaction; the user row is locked so bests update one at a time.
  async append(
    manager: EntityManager,
    userId: string,
    entries: NewLiftEntry[],
  ): Promise<RepMaxEntry[]> {
    const user = await manager.findOneOrFail(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    const saved: RepMaxEntry[] = [];
    for (const entry of entries) {
      const weightKg = roundKg(entry.weightKg);
      saved.push(
        await manager.save(
          manager.create(RepMaxEntry, {
            userId,
            exerciseId: entry.exerciseId,
            reps: entry.reps,
            weightKg,
            unit: user.weightUnit,
            achievedOn: entry.achievedOn,
            source: entry.source,
            workoutSetId: entry.workoutSetId ?? null,
          }),
        ),
      );

      const current = await manager.findOneBy(UserBestLift, {
        userId,
        exerciseId: entry.exerciseId,
      });
      const next = nextBest(current, { ...entry, weightKg });
      if (next && next !== current) {
        await manager.save(
          manager.create(UserBestLift, {
            ...(current ?? { userId, exerciseId: entry.exerciseId }),
            ...next,
            unit: user.weightUnit,
          }),
        );
      }
    }
    return saved;
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
        where: { userId: user.id, exerciseId },
        order: { achievedOn: 'ASC', createdAt: 'ASC' },
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

  // A made, logged set of 1-3 reps on a max-trackable exercise, once.
  async recordFromSet(user: AuthUser, setId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const set = await manager.findOne(WorkoutSet, {
          where: {
            id: setId,
            workoutExercise: { workout: { userId: user.id } },
          },
          relations: { workoutExercise: { workout: true, exercise: true } },
        });
        if (!set) throw new NotFoundException(`Set "${setId}" not found`);

        const reps = set.actualReps ?? set.reps;
        const weightKg = set.actualWeight ?? set.weight;
        if (set.made !== true) {
          throw new BadRequestException('Only a made set can be recorded');
        }
        if (reps < 1 || reps > MAX_REP_MAX_REPS) {
          throw new BadRequestException('A rep max has 1 to 3 reps');
        }
        if (weightKg === null || weightKg <= 0) {
          throw new BadRequestException('The set has no weight');
        }
        if (!set.workoutExercise.exercise.isMaxTrackable) {
          throw new BadRequestException(
            'Rep maxes are not tracked for this exercise',
          );
        }
        if (await manager.existsBy(RepMaxEntry, { workoutSetId: setId })) {
          throw new ConflictException('This set is already recorded');
        }

        const [entry] = await this.append(manager, user.id, [
          {
            exerciseId: set.workoutExercise.exerciseId,
            reps,
            weightKg,
            achievedOn: dateOf(set.workoutExercise.workout.date),
            source: LiftRecordSource.LOGGED_SET,
            workoutSetId: setId,
          },
        ]);
        return this.withBest(manager, entry);
      });
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('This set is already recorded');
      }
      throw error;
    }
  }

  private async withBest(manager: EntityManager, entry: RepMaxEntry) {
    const best = await manager.findOneBy(UserBestLift, {
      userId: entry.userId,
      exerciseId: entry.exerciseId,
    });
    return { entry: entryView(entry), best: best ? bestView(best) : null };
  }
}
