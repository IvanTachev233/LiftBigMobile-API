import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { WorkoutsService } from './workouts.service';
import { UpdateWorkoutDto } from './dto/workout.dto';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutExercise } from './entities/workout-exercise.entity';
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

  // One stored workout standing in for the workout / workout_exercise /
  // workout_set tables. Reads return copies with `exercise` joined, in
  // storage order (not sorted), so sorting must come from the service.
  type StoredSet = Partial<WorkoutSet>;
  type StoredCard = Omit<Partial<WorkoutExercise>, 'sets'> & {
    sets: StoredSet[];
  };
  let stored: Omit<Partial<Workout>, 'exercises'> & { exercises: StoredCard[] };
  let generatedIds: number;

  const loadWorkout = (): Workout =>
    ({
      ...stored,
      exercises: stored.exercises.map((c) => ({
        ...c,
        exercise: exercises.find((e) => e.id === c.exerciseId),
        sets: c.sets.map((set) => ({ ...set })),
      })),
    }) as unknown as Workout;

  const workoutRepo = {
    findOne: jest.fn((opts: { where: Where }) =>
      Promise.resolve(
        opts.where.id === stored.id && opts.where.userId === stored.userId
          ? loadWorkout()
          : null,
      ),
    ),
    find: jest.fn<Promise<Workout[]>, [unknown]>(() =>
      Promise.resolve([loadWorkout()]),
    ),
    create: jest.fn((data: Partial<Workout>) => ({ ...data }) as Workout),
    save: jest.fn((w: Workout) => Promise.resolve({ ...w, id: 'new-workout' })),
    manager: {
      transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) =>
        cb(manager),
      ),
    },
  };

  const manager = {
    delete: jest.fn((_target: unknown, where: Where) => {
      if (where.workoutId === stored.id) stored.exercises = [];
      return Promise.resolve({ affected: 1 });
    }),
    create: jest.fn((_target: unknown, data: unknown) => data),
    save: jest.fn((_target: unknown, cards: StoredCard[]) => {
      for (const c of cards) {
        c.id ??= `gen-card-${++generatedIds}`;
        for (const set of c.sets) {
          set.id ??= `gen-set-${++generatedIds}`;
          set.workoutExerciseId = c.id;
        }
        stored.exercises.push(c);
      }
      return Promise.resolve(cards);
    }),
    update: jest.fn(
      (_target: unknown, where: Where, patch: Partial<Workout>) => {
        if (where.id === stored.id) Object.assign(stored, patch);
        return Promise.resolve({ affected: 1 });
      },
    ),
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
    generatedIds = 0;
    // Cards and sets stored out of order on purpose.
    stored = {
      id: 'workout-1',
      userId: 'coach-1',
      name: 'Push',
      totalWeightLifted: 0,
      exercises: [
        {
          id: 'card-b',
          workoutId: 'workout-1',
          exerciseId: 'coach1-ex',
          order: 2,
          supersetGroup: null,
          sets: [
            {
              id: 'set-b2',
              workoutExerciseId: 'card-b',
              reps: 8,
              weight: 20,
              order: 2,
            },
            {
              id: 'set-b1',
              workoutExerciseId: 'card-b',
              reps: 8,
              weight: 10,
              order: 1,
            },
          ],
        },
        {
          id: 'card-a',
          workoutId: 'workout-1',
          exerciseId: 'global-1',
          order: 1,
          supersetGroup: null,
          sets: [
            {
              id: 'set-a1',
              workoutExerciseId: 'card-a',
              reps: 5,
              weight: 100,
              order: 1,
            },
          ],
        },
      ],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: getRepositoryToken(Workout), useValue: workoutRepo },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
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

  const cardSummary = (w: Workout) =>
    w.exercises.map((c) => ({
      id: c.id,
      exerciseId: c.exerciseId,
      order: c.order,
      sets: c.sets.map((set) => set.id),
    }));

  describe('reads return cards sorted by order, then sets by order', () => {
    const expected = [
      { id: 'card-a', exerciseId: 'global-1', order: 1, sets: ['set-a1'] },
      {
        id: 'card-b',
        exerciseId: 'coach1-ex',
        order: 2,
        sets: ['set-b1', 'set-b2'],
      },
    ];

    it('findOne', async () => {
      const workout = await service.findOne('workout-1', coach1);
      expect(cardSummary(workout)).toEqual(expected);
      expect(workout.exercises[0].exercise.id).toBe('global-1');
      expect(workout).not.toHaveProperty('sets');
    });

    it('findAll', async () => {
      const [workout] = await service.findAll(coach1);
      expect(cardSummary(workout)).toEqual(expected);
    });

    it('findUpcoming', async () => {
      const [workout] = await service.findUpcoming(coach1);
      expect(cardSummary(workout)).toEqual(expected);
    });

    it.each(['findAll', 'findUpcoming'] as const)(
      '%s loads cards with their exercise and sets',
      async (method) => {
        await service[method](coach1);
        expect(workoutRepo.find.mock.calls[0][0]).toMatchObject({
          relations: ['exercises', 'exercises.exercise', 'exercises.sets'],
        });
      },
    );

    it("findOne 404s on another user's workout", async () => {
      await expect(service.findOne('workout-1', coach2)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('returns the new workout with an empty card list', async () => {
      const result = await service.create(
        { name: 'New', date: '2026-10-03' },
        coach1,
      );
      expect(result).toMatchObject({ name: 'New', userId: 'coach-1' });
      expect(result.exercises).toEqual([]);
    });
  });

  describe('update — cards', () => {
    it('stores 2 cards using the same exercise, each with its own sets, in order', async () => {
      await service.update(
        'workout-1',
        {
          exercises: [
            {
              exerciseId: 'global-1',
              order: 2,
              sets: [
                { reps: 3, weight: 120, order: 2 },
                { reps: 5, weight: 100, order: 1 },
              ],
            },
            {
              exerciseId: 'global-1',
              order: 1,
              sets: [{ reps: 10, weight: 60 }],
            },
          ],
        },
        coach1,
      );

      const reloaded = await service.findOne('workout-1', coach1);
      expect(reloaded.exercises).toHaveLength(2);
      expect(
        reloaded.exercises.map((c) => ({
          exerciseId: c.exerciseId,
          order: c.order,
          sets: c.sets.map((set) => [set.order, set.reps, set.weight]),
        })),
      ).toEqual([
        { exerciseId: 'global-1', order: 1, sets: [[1, 10, 60]] },
        {
          exerciseId: 'global-1',
          order: 2,
          sets: [
            [1, 5, 100],
            [2, 3, 120],
          ],
        },
      ]);
      expect(reloaded.exercises[0].id).not.toBe(reloaded.exercises[1].id);
    });

    it('returns the reloaded, sorted workout from update', async () => {
      const result = await service.update(
        'workout-1',
        {
          exercises: [
            { exerciseId: 'coach1-ex', order: 2, sets: [] },
            { exerciseId: 'global-1', order: 1, sets: [] },
          ],
        },
        coach1,
      );
      expect(result.exercises.map((c) => c.exerciseId)).toEqual([
        'global-1',
        'coach1-ex',
      ]);
      expect(result.exercises[0].exercise.name).toBe('Bench Press');
    });

    it('numbers sets without an order by their position in the card', async () => {
      await service.update(
        'workout-1',
        {
          exercises: [
            {
              exerciseId: 'global-1',
              order: 1,
              sets: [
                { reps: 1, weight: 1 },
                { reps: 2, weight: 2 },
              ],
            },
          ],
        },
        coach1,
      );
      expect(stored.exercises[0].sets.map((set) => set.order)).toEqual([1, 2]);
      expect(stored.exercises[0].sets.map((set) => set.isCompleted)).toEqual([
        false,
        false,
      ]);
    });

    it('replaces every card and recomputes totalWeightLifted over all sets', async () => {
      const result = await service.update(
        'workout-1',
        {
          exercises: [
            {
              exerciseId: 'global-1',
              order: 1,
              sets: [
                { reps: 5, weight: 100 },
                { reps: 3, weight: 110 },
              ],
            },
            {
              exerciseId: 'coach1-ex',
              order: 2,
              sets: [{ reps: 10, weight: 22.5 }],
            },
          ],
        },
        coach1,
      );
      expect(manager.delete).toHaveBeenCalledWith(WorkoutExercise, {
        workoutId: 'workout-1',
      });
      // 5*100 + 3*110 + 10*22.5
      expect(result.totalWeightLifted).toBe(1055);
      expect(stored.exercises.map((c) => c.id)).not.toContain('card-a');
    });

    it('clears all cards and the total for an empty exercises list', async () => {
      stored.totalWeightLifted = 500;
      const result = await service.update(
        'workout-1',
        { exercises: [] },
        coach1,
      );
      expect(result.exercises).toEqual([]);
      expect(result.totalWeightLifted).toBe(0);
    });

    it('keeps the cards on a name/date/status-only update', async () => {
      const result = await service.update(
        'workout-1',
        {
          name: 'Renamed',
          date: '2026-10-04',
          status: WorkoutStatus.COMPLETED,
        },
        coach1,
      );
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(result.name).toBe('Renamed');
      expect(result.status).toBe(WorkoutStatus.COMPLETED);
      expect(cardSummary(result).map((c) => c.id)).toEqual([
        'card-a',
        'card-b',
      ]);
      expect(result.exercises[1].sets).toHaveLength(2);
    });

    it('updates only the fields sent, given a transformed DTO instance', async () => {
      const dto = plainToInstance(UpdateWorkoutDto, { name: 'Renamed' });
      await service.update('workout-1', dto, coach1);
      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(Object.keys(manager.update.mock.calls[0][2])).toEqual(['name']);
      expect(stored.exercises).toHaveLength(2);
    });

    it('runs the card replacement inside one transaction', async () => {
      await service.update(
        'workout-1',
        { exercises: [{ exerciseId: 'global-1', order: 1, sets: [] }] },
        coach1,
      );
      expect(workoutRepo.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it("404s on another user's workout without touching it", async () => {
      await expect(
        service.update('workout-1', { exercises: [] }, coach2),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.delete).not.toHaveBeenCalled();
    });
  });

  describe('update — card and set ids', () => {
    it('keeps own card and set ids', async () => {
      await service.update(
        'workout-1',
        {
          exercises: [
            {
              id: 'card-b',
              exerciseId: 'coach1-ex',
              order: 1,
              sets: [
                { id: 'set-b1', reps: 8, weight: 12, order: 1 },
                { reps: 8, weight: 14, order: 2 },
              ],
            },
          ],
        },
        coach1,
      );
      const reloaded = await service.findOne('workout-1', coach1);
      expect(cardSummary(reloaded)).toEqual([
        {
          id: 'card-b',
          exerciseId: 'coach1-ex',
          order: 1,
          sets: ['set-b1', 'gen-set-1'],
        },
      ]);
      expect(reloaded.exercises[0].sets[0].weight).toBe(12);
    });

    it('rejects a card id from another workout and changes nothing', async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              {
                id: 'card-of-other-workout',
                exerciseId: 'global-1',
                order: 1,
                sets: [],
              },
            ],
          },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rejects a set id from another workout', async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              {
                id: 'card-a',
                exerciseId: 'global-1',
                order: 1,
                sets: [{ id: 'set-of-other-workout', reps: 5, weight: 100 }],
              },
            ],
          },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('rejects a set id that belongs to a different card of this workout', async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              {
                id: 'card-a',
                exerciseId: 'global-1',
                order: 1,
                sets: [{ id: 'set-b1', reps: 5, weight: 100 }],
              },
            ],
          },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an own set id placed on a new card (no id)', async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              {
                exerciseId: 'global-1',
                order: 1,
                sets: [{ id: 'set-a1', reps: 5, weight: 100 }],
              },
            ],
          },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects the same card id used twice', async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              { id: 'card-a', exerciseId: 'global-1', order: 1, sets: [] },
              { id: 'card-a', exerciseId: 'global-1', order: 2, sets: [] },
            ],
          },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects the same set id used twice', async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              {
                id: 'card-b',
                exerciseId: 'coach1-ex',
                order: 1,
                sets: [
                  { id: 'set-b1', reps: 5, weight: 100 },
                  { id: 'set-b1', reps: 5, weight: 100 },
                ],
              },
            ],
          },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update — exerciseId visibility and supersetGroup', () => {
    it("rejects a card with another coach's private exercise and changes nothing", async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              { exerciseId: 'global-1', order: 1, sets: [] },
              {
                exerciseId: 'coach2-ex',
                order: 2,
                sets: [{ weight: 100, reps: 5 }],
              },
            ],
          },
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('accepts a global or own exerciseId', async () => {
      await expect(
        service.update(
          'workout-1',
          {
            exercises: [
              { exerciseId: 'global-1', order: 1, sets: [] },
              {
                exerciseId: 'coach1-ex',
                order: 2,
                sets: [{ weight: 100, reps: 5 }],
              },
            ],
          },
          coach1,
        ),
      ).resolves.toBeDefined();
    });

    it("lets a client use their coach's exercise but not another coach's", async () => {
      stored.userId = 'client-1';
      await expect(
        service.update(
          'workout-1',
          { exercises: [{ exerciseId: 'coach1-ex', order: 1, sets: [] }] },
          clientOfCoach1,
        ),
      ).resolves.toBeDefined();
      await expect(
        service.update(
          'workout-1',
          { exercises: [{ exerciseId: 'coach2-ex', order: 1, sets: [] }] },
          clientOfCoach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('saves supersetGroup on cards sharing one and null on the rest', async () => {
      const result = await service.update(
        'workout-1',
        {
          exercises: [
            {
              exerciseId: 'global-1',
              order: 1,
              supersetGroup: 'group-1',
              sets: [{ weight: 100, reps: 5 }],
            },
            {
              exerciseId: 'coach1-ex',
              order: 2,
              supersetGroup: 'group-1',
              sets: [{ weight: 50, reps: 5 }],
            },
            {
              exerciseId: 'global-1',
              order: 3,
              sets: [{ weight: 50, reps: 5 }],
            },
          ],
        },
        coach1,
      );
      expect(result.exercises.map((c) => c.supersetGroup)).toEqual([
        'group-1',
        'group-1',
        null,
      ]);
    });
  });
});
