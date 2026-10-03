import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { WorkoutsService } from './workouts.service';
import { Workout } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import { AuthUser } from '../auth/auth-user.interface';

type Where = Record<string, unknown>;

// Evaluates TypeORM where clauses (OR arrays, IsNull, ILike, Raw) against
// in-memory fixtures. ILike follows Postgres wildcard rules; Raw accepts only
// the duplicate-name SQL and throws on anything else.
function ilikeToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '%') {
      source += '[\\s\\S]*';
    } else if (ch === '_') {
      source += '[\\s\\S]';
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'i');
}

const EXACT_NAME_SQL = 'LOWER(col) = LOWER(:exerciseName)';

function matchesClause(exercise: Exercise, clause: Where): boolean {
  return Object.entries(clause).every(([key, value]) => {
    const actual = (exercise as unknown as Record<string, unknown>)[key];
    if (value instanceof FindOperator) {
      if (value.type === 'isNull') return actual === null;
      if (value.type === 'ilike') {
        return (
          typeof actual === 'string' &&
          ilikeToRegExp(String(value.value)).test(actual)
        );
      }
      if (value.type === 'raw') {
        const sql = value.getSql?.('col');
        if (sql !== EXACT_NAME_SQL) {
          throw new Error(`Unsupported Raw SQL in test double: ${sql}`);
        }
        const params = (value.objectLiteralParameters ?? {}) as Record<
          string,
          unknown
        >;
        return (
          typeof actual === 'string' &&
          actual.toLowerCase() === String(params.exerciseName).toLowerCase()
        );
      }
      return false;
    }
    return actual === value;
  });
}

function filterByWhere(
  exercises: Exercise[],
  where: Where | Where[],
): Exercise[] {
  const clauses = Array.isArray(where) ? where : [where];
  return exercises.filter((ex) => clauses.some((c) => matchesClause(ex, c)));
}

const makeExercise = (overrides: Partial<Exercise>): Exercise =>
  ({
    id: 'ex-id',
    name: 'Squat',
    description: null,
    bodyPart: 'LG',
    createdById: null,
    videoUrl: null,
    imageUrl: null,
    ...overrides,
  }) as unknown as Exercise;

describe('WorkoutsService', () => {
  let service: WorkoutsService;
  let exercises: Exercise[];

  const exerciseRepo = {
    find: jest.fn((opts: { where: Where | Where[] }) =>
      Promise.resolve(filterByWhere(exercises, opts.where)),
    ),
    findOne: jest.fn((opts: { where: Where | Where[] }) =>
      Promise.resolve(filterByWhere(exercises, opts.where)[0] ?? null),
    ),
    count: jest.fn((opts: { where: Where | Where[] }) =>
      Promise.resolve(filterByWhere(exercises, opts.where).length),
    ),
    create: jest.fn(
      (data: Partial<Exercise>) => ({ ...data }) as unknown as Exercise,
    ),
    save: jest.fn((e: Exercise) => Promise.resolve(e)),
  };

  const setRepo = {
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    create: jest.fn((data: Partial<WorkoutSet>) => data as WorkoutSet),
    save: jest.fn((rows: WorkoutSet[]) => Promise.resolve(rows)),
  };

  const workoutRepo = {
    findOne: jest.fn(),
    save: jest.fn((w: Workout) => Promise.resolve(w)),
  };

  const coach1: AuthUser = {
    id: 'coach-1',
    email: 'coach1@example.com',
    name: null,
    role: 'COACH',
    coachId: null,
  };
  const coach2: AuthUser = {
    id: 'coach-2',
    email: 'coach2@example.com',
    name: null,
    role: 'COACH',
    coachId: null,
  };
  const clientOfCoach1: AuthUser = {
    id: 'client-1',
    email: 'client1@example.com',
    name: null,
    role: 'CLIENT',
    coachId: 'coach-1',
  };
  const clientNoCoach: AuthUser = {
    id: 'client-2',
    email: 'client2@example.com',
    name: null,
    role: 'CLIENT',
    coachId: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    exercises = [
      makeExercise({ id: 'global-1', name: 'Bench Press', createdById: null }),
      makeExercise({
        id: 'coach1-ex',
        name: 'Coach1 Special',
        createdById: 'coach-1',
      }),
      makeExercise({
        id: 'coach2-ex',
        name: 'Coach2 Special',
        createdById: 'coach-2',
      }),
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: getRepositoryToken(Workout), useValue: workoutRepo },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        { provide: getRepositoryToken(WorkoutSet), useValue: setRepo },
      ],
    }).compile();

    service = module.get<WorkoutsService>(WorkoutsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllExercises', () => {
    it("coach sees global + own, not another coach's", async () => {
      const result = await service.findAllExercises(coach1);
      expect(result.map((e) => e.id).sort()).toEqual(['coach1-ex', 'global-1']);
    });

    it("client sees global + their coach's", async () => {
      const result = await service.findAllExercises(clientOfCoach1);
      expect(result.map((e) => e.id).sort()).toEqual(['coach1-ex', 'global-1']);
    });

    it('client with no coach sees global only', async () => {
      const result = await service.findAllExercises(clientNoCoach);
      expect(result.map((e) => e.id)).toEqual(['global-1']);
    });
  });

  describe('createExercise', () => {
    it('sets createdById from the caller', async () => {
      const result = await service.createExercise({ name: 'New Move' }, coach1);
      expect(result).toMatchObject({
        name: 'New Move',
        createdById: 'coach-1',
      });
    });

    it('409s on a case-insensitive, trimmed name clash visible to the coach', async () => {
      await expect(
        service.createExercise({ name: 'bench press' }, coach1),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.createExercise({ name: 'coach1 special' }, coach1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("lets a second coach reuse the first coach's name", async () => {
      const result = await service.createExercise(
        { name: 'Coach1 Special' },
        coach2,
      );
      expect(result).toMatchObject({ createdById: 'coach-2' });
    });

    it('does not treat _ or % in the new name as wildcards', async () => {
      exercises.push(
        makeExercise({ id: 'global-2', name: 'Squats', createdById: null }),
      );
      await expect(
        service.createExercise({ name: 'Squat_' }, coach1),
      ).resolves.toMatchObject({ name: 'Squat_', createdById: 'coach-1' });
      await expect(
        service.createExercise({ name: 'Bench%' }, coach1),
      ).resolves.toMatchObject({ name: 'Bench%' });
      await expect(
        service.createExercise({ name: '%' }, coach1),
      ).resolves.toMatchObject({ name: '%' });
    });

    it('still 409s on an exact name containing _ or %, ignoring case', async () => {
      exercises.push(
        makeExercise({
          id: 'coach1-pct',
          name: '100%_Pull',
          createdById: 'coach-1',
        }),
      );
      await expect(
        service.createExercise({ name: '100%_pull' }, coach1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('checks the name with a bound LOWER() = LOWER() comparison over the visible set', async () => {
      await service.createExercise({ name: 'Squat_' }, coach1);

      const { where } = exerciseRepo.findOne.mock.calls[0][0] as {
        where: Where[];
      };
      expect(where).toHaveLength(2);
      for (const clause of where) {
        const op = clause.name as FindOperator<string>;
        expect(op).toBeInstanceOf(FindOperator);
        expect(op.type).toBe('raw');
        expect(op.getSql?.('"Exercise"."name"')).toBe(
          'LOWER("Exercise"."name") = LOWER(:exerciseName)',
        );
        expect(op.objectLiteralParameters).toEqual({ exerciseName: 'Squat_' });
      }
      expect((where[0].createdById as FindOperator<unknown>).type).toBe(
        'isNull',
      );
      expect(where[1].createdById).toBe('coach-1');
    });
  });

  describe('update — exerciseId visibility and supersetGroup', () => {
    beforeEach(() => {
      workoutRepo.findOne.mockResolvedValue({
        id: 'workout-1',
        userId: 'coach-1',
        sets: [],
      } as unknown as Workout);
    });

    it('rejects a set exerciseId not visible to the caller', async () => {
      await expect(
        service.update(
          'workout-1',
          { sets: [{ exerciseId: 'coach2-ex', weight: 100, reps: 5 }] },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a global or own exerciseId', async () => {
      await expect(
        service.update(
          'workout-1',
          { sets: [{ exerciseId: 'coach1-ex', weight: 100, reps: 5 }] },
          coach1,
        ),
      ).resolves.toBeDefined();
    });

    it('saves supersetGroup on sets sharing one', async () => {
      const result = await service.update(
        'workout-1',
        {
          sets: [
            {
              exerciseId: 'global-1',
              weight: 100,
              reps: 5,
              supersetGroup: 'group-1',
            },
            {
              exerciseId: 'coach1-ex',
              weight: 50,
              reps: 5,
              supersetGroup: 'group-1',
            },
          ],
        },
        coach1,
      );
      expect(result.sets.every((s) => s.supersetGroup === 'group-1')).toBe(
        true,
      );
    });
  });
});
