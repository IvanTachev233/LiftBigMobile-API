import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { User } from '../auth/user.entity';
import { addDays, todayUtc } from '../common/calendar-date';
import { setupEntries } from '../lifts/domain/best-lift';
import { LiftRecordSource } from '../lifts/entities/lift-record-source';
import { UserBestLift } from '../lifts/entities/user-best-lift.entity';
import { LiftRecordsService } from '../lifts/lift-records.service';
import { WorkoutExercise } from '../workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../workouts/entities/workout-set.entity';
import { Workout, WorkoutStatus } from '../workouts/entities/workout.entity';
import {
  CARD_RELATIONS,
  setIdsOf,
  toWorkoutView,
} from '../workouts/workout-cards';
import { buildSchedule } from './domain/schedule';
import { prescribedTargetKg, targetWeightKg } from './domain/weights';
import {
  CreateEnrollmentDto,
  MaxInput,
  RecalculateEnrollmentDto,
} from './dto/enrollment.dto';
import {
  ProgramEnrollment,
  ProgramEnrollmentStatus,
} from './entities/program-enrollment.entity';
import { ProgramTemplate } from './entities/program-template.entity';
import { Sport } from './entities/sport.entity';
import {
  loadProgramWithSport,
  referenceLifts,
} from './program-catalog.service';

const UNIQUE_VIOLATION = '23505';

// A client's runs of published programs. Every write is one transaction
// that starts by locking the user row.
@Injectable()
export class EnrollmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly lifts: LiftRecordsService,
  ) {}

  async enroll(user: AuthUser, dto: CreateEnrollmentDto) {
    // One day of slack for clients behind UTC.
    if (dto.startDate < addDays(todayUtc(), -1)) {
      throw new BadRequestException('startDate cannot be in the past');
    }
    assertDistinctLifts(dto.maxes);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const owner = await lockUser(manager, user.id);
        const { program, sport } = await loadProgramWithSport(
          manager,
          dto.programId,
          { publishedOnly: true },
        );
        const maxesKg = checkMaxes(program, sport, dto.maxes);

        const active = await manager.findOneBy(ProgramEnrollment, {
          userId: user.id,
          status: ProgramEnrollmentStatus.ACTIVE,
        });
        if (active && !dto.abandonCurrent) {
          throw new ConflictException('You already have an active program');
        }
        if (active) await abandonEnrollment(manager, this.lifts, active.id);

        await this.recordSetupMaxes(manager, user.id, dto.maxes);
        const enrollment = await manager.save(
          manager.create(ProgramEnrollment, {
            userId: user.id,
            programId: program.id,
            programVersion: program.version,
            startDate: dto.startDate,
            status: ProgramEnrollmentStatus.ACTIVE,
            maxesSnapshot: maxesKg,
          }),
        );
        await this.createWorkouts(manager, owner, program, enrollment);
        return enrollmentView(manager, this.lifts, enrollment.id);
      });
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('You already have an active program');
      }
      throw error;
    }
  }

  async active(user: AuthUser) {
    const enrollment = await this.dataSource
      .getRepository(ProgramEnrollment)
      .findOneBy({ userId: user.id, status: ProgramEnrollmentStatus.ACTIVE });
    return {
      active: enrollment
        ? await enrollmentView(
            this.dataSource.manager,
            this.lifts,
            enrollment.id,
          )
        : null,
    };
  }

  // Ends the enrollment and deletes its PLANNED workouts; started and
  // completed ones stay.
  async abandon(user: AuthUser, id: string) {
    return this.dataSource.transaction(async (manager) => {
      await lockUser(manager, user.id);
      await activeEnrollment(manager, user.id, id);
      await abandonEnrollment(manager, this.lifts, id);
      return enrollmentView(manager, this.lifts, id);
    });
  }

  // Applies new maxes to the targets of the enrollment's PLANNED workouts.
  async recalculate(user: AuthUser, id: string, dto: RecalculateEnrollmentDto) {
    assertDistinctLifts(dto.maxes);
    return this.dataSource.transaction(async (manager) => {
      const owner = await lockUser(manager, user.id);
      const enrollment = await activeEnrollment(manager, user.id, id);
      const { program, sport } = await loadProgramWithSport(
        manager,
        enrollment.programId,
        { publishedOnly: false },
      );
      const maxesKg = checkMaxes(program, sport, dto.maxes);
      await this.recordSetupMaxes(manager, user.id, dto.maxes);
      await manager.update(
        ProgramEnrollment,
        { id },
        { maxesSnapshot: maxesKg },
      );

      const planned = await manager.find(Workout, {
        select: { id: true },
        where: { programEnrollmentId: id, status: WorkoutStatus.PLANNED },
        lock: { mode: 'pessimistic_write' },
      });
      const sets = await manager.find(WorkoutSet, {
        where: {
          prescribedPercent: Not(IsNull()),
          workoutExercise: { workoutId: In(planned.map((w) => w.id)) },
        },
      });
      for (const set of sets) {
        const weight = targetWeightKg(
          maxesKg[set.referenceExerciseId!],
          set.prescribedPercent,
          owner.weightUnit,
        );
        await manager.update(WorkoutSet, { id: set.id }, { weight });
      }
      return enrollmentView(manager, this.lifts, id);
    });
  }

  // Entered maxes that differ from the user's best become 1-rep entries.
  private async recordSetupMaxes(
    manager: EntityManager,
    userId: string,
    maxes: MaxInput[],
  ): Promise<void> {
    const bests = await manager.findBy(UserBestLift, {
      userId,
      exerciseId: In(maxes.map((m) => m.exerciseId)),
    });
    const achievedOn = todayUtc();
    await this.lifts.append(
      manager,
      userId,
      setupEntries(maxes, bests).map((max) => ({
        exerciseId: max.exerciseId,
        reps: 1,
        weightKg: max.weightKg,
        achievedOn,
        source: LiftRecordSource.PROGRAM_SETUP,
      })),
    );
  }

  // One PLANNED workout per template session, cards in template order and
  // one set row per prescribed set.
  private async createWorkouts(
    manager: EntityManager,
    owner: User,
    program: ProgramTemplate,
    enrollment: ProgramEnrollment,
  ): Promise<void> {
    for (const { session, date } of buildSchedule(
      program,
      enrollment.startDate,
    )) {
      await manager.save(
        manager.create(Workout, {
          userId: owner.id,
          assignedById: null,
          programEnrollmentId: enrollment.id,
          programSessionId: session.id,
          name: `${program.name}: ${session.title}`,
          date: new Date(date),
          notes: session.notes,
          status: WorkoutStatus.PLANNED,
          exercises: session.exercises.map((exercise) =>
            manager.create(WorkoutExercise, {
              exerciseId: exercise.exerciseId,
              order: exercise.order,
              supersetGroup: null,
              sets: Array.from({ length: exercise.sets }, (_, i) =>
                manager.create(WorkoutSet, {
                  reps: exercise.reps,
                  weight: prescribedTargetKg(
                    exercise,
                    enrollment.maxesSnapshot,
                    owner.weightUnit,
                  ),
                  prescribedPercent: exercise.percentOf1RM,
                  referenceExerciseId: exercise.referenceExerciseId,
                  order: i + 1,
                  notes: null,
                  made: null,
                  actualReps: null,
                  actualWeight: null,
                }),
              ),
            }),
          ),
        }),
      );
    }
  }
}

function lockUser(manager: EntityManager, id: string): Promise<User> {
  return manager.findOneOrFail(User, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
}

async function activeEnrollment(
  manager: EntityManager,
  userId: string,
  id: string,
): Promise<ProgramEnrollment> {
  const enrollment = await manager.findOneBy(ProgramEnrollment, {
    id,
    userId,
  });
  if (!enrollment) {
    throw new NotFoundException(`Enrollment "${id}" not found`);
  }
  if (enrollment.status !== ProgramEnrollmentStatus.ACTIVE) {
    throw new ConflictException(`This program is ${enrollment.status}`);
  }
  return enrollment;
}

// Rep max entries of the deleted workouts' sets go with them.
async function abandonEnrollment(
  manager: EntityManager,
  lifts: LiftRecordsService,
  id: string,
): Promise<void> {
  await manager.update(
    ProgramEnrollment,
    { id },
    { status: ProgramEnrollmentStatus.ABANDONED },
  );
  const planned = {
    programEnrollmentId: id,
    status: WorkoutStatus.PLANNED,
  };
  const recorded = await lifts.recordedExercises(manager, planned);
  await manager.delete(Workout, planned);
  await lifts.recomputeAfterDelete(manager, recorded);
}

function assertDistinctLifts(maxes: MaxInput[]): void {
  const ids = maxes.map((m) => m.exerciseId);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('Each lift can have one max');
  }
}

// Every reference lift needs a max; other entries must be lifts of the
// sport. Returns the maxes in kg (2 decimals) keyed by exercise id.
function checkMaxes(
  program: ProgramTemplate,
  sport: Sport,
  maxes: MaxInput[],
): Record<string, number> {
  const entered = new Map(maxes.map((m) => [m.exerciseId, m.weightKg]));
  const references = referenceLifts(program, sport);
  const missing = references.filter((lift) => !entered.has(lift.exerciseId));
  if (missing.length > 0) {
    throw new BadRequestException({
      message: `Enter a max for ${missing.map((l) => l.label).join(', ')}`,
      missing,
    });
  }
  const allowed = new Set([
    ...references.map((l) => l.exerciseId),
    ...sport.requiredLifts.map((l) => l.exerciseId),
  ]);
  const unknown = maxes.filter((m) => !allowed.has(m.exerciseId));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `Not a lift of this program: ${unknown.map((m) => m.exerciseId).join(', ')}`,
    );
  }
  return Object.fromEntries(
    maxes.map((m) => [m.exerciseId, Math.round(m.weightKg * 100) / 100]),
  );
}

async function enrollmentView(
  manager: EntityManager,
  lifts: LiftRecordsService,
  id: string,
) {
  const enrollment = await manager.findOneOrFail(ProgramEnrollment, {
    where: { id },
    relations: { program: true },
  });
  const workouts = await manager.find(Workout, {
    where: { programEnrollmentId: id },
    relations: CARD_RELATIONS,
    order: { date: 'ASC' },
  });
  const { program } = enrollment;
  const pbs = await lifts.pbSetIds(manager, setIdsOf(workouts));
  return {
    id: enrollment.id,
    status: enrollment.status,
    startDate: enrollment.startDate,
    programId: enrollment.programId,
    programVersion: enrollment.programVersion,
    maxesSnapshot: enrollment.maxesSnapshot,
    createdAt: enrollment.createdAt,
    program: {
      id: program.id,
      name: program.name,
      sportId: program.sportId,
      durationWeeks: program.durationWeeks,
      sessionsPerWeek: program.sessionsPerWeek,
    },
    workouts: workouts.map((workout) =>
      toWorkoutView(workout, new Map([[enrollment.id, program.name]]), pbs),
    ),
  };
}
