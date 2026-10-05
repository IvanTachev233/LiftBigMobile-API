import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { WorkoutsService } from './workouts.service';
import {
  CreateWorkoutDto,
  UpdateWorkoutDto,
  WorkoutExerciseInput,
} from './dto/workout.dto';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { AuthUser } from '../auth/auth-user.interface';
import {
  createFakeWorkoutDb,
  FakeWorkoutDb,
  workoutFixture,
} from '../../test/fake-workout-db';

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

const user = (
  id: string,
  role: 'COACH' | 'CLIENT',
  coachId: string | null = null,
): AuthUser => ({
  id,
  email: `${id}@example.com`,
  name: `${id} name`,
  role,
  coachId,
});

describe('WorkoutsService', () => {
  let service: WorkoutsService;
  let exercises: Exercise[];
  let fake: FakeWorkoutDb;

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

  const coach1 = user('coach-1', 'COACH');
  const coach2 = user('coach-2', 'COACH');
  const clientOfCoach1 = user('client-1', 'CLIENT', 'coach-1');
  const clientNoCoach = user('client-2', 'CLIENT');

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
    // workout-1: coach-1's own workout. assigned-1: assigned to client-1 by
    // coach-1. other-1: client-2's own workout.
    const own = workoutFixture({ id: 'workout-1', userId: 'coach-1' });
    const assigned = workoutFixture({
      id: 'assigned-1',
      userId: 'client-1',
      assignedById: 'coach-1',
    });
    const other = workoutFixture({ id: 'other-1', userId: 'client-2' });
    fake = createFakeWorkoutDb(
      {
        workouts: [...own.workouts, ...assigned.workouts, ...other.workouts],
        cards: [...own.cards, ...assigned.cards, ...other.cards],
        sets: [...own.sets, ...assigned.sets, ...other.sets],
        users: [coach1, coach2, clientOfCoach1, clientNoCoach].map((u) => ({
          ...u,
        })),
        exercises,
      },
      exerciseRepo,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: getRepositoryToken(Workout), useValue: fake.workoutRepo },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
      ],
    }).compile();

    service = module.get<WorkoutsService>(WorkoutsService);
  });

  const noWrites = () => expect(fake.writes).toEqual([]);

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

  // The row lock must be the transaction's first read, on the bare row.
  const expectLockedFirst = (where: Where) => {
    expect(fake.reads[0]).toEqual({
      entity: 'Workout',
      where,
      lock: { mode: 'pessimistic_write' },
      relations: undefined,
    });
  };

  describe('reads return cards sorted by order, then sets by order', () => {
    const expected = [
      {
        id: 'workout-1-card-a',
        exerciseId: 'global-1',
        order: 1,
        sets: ['workout-1-set-a1'],
      },
      {
        id: 'workout-1-card-b',
        exerciseId: 'coach1-ex',
        order: 2,
        sets: ['workout-1-set-b1', 'workout-1-set-b2'],
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
      '%s loads cards with their exercise and sets, and the assigning coach',
      async (method) => {
        await service[method](coach1);
        expect(fake.workoutRepo.find.mock.calls[0][0]).toMatchObject({
          where: { userId: 'coach-1' },
          relations: [
            'exercises',
            'exercises.exercise',
            'exercises.sets',
            'assignedBy',
          ],
        });
      },
    );

    it("findOne 404s on another user's workout", async () => {
      await expect(service.findOne('workout-1', coach2)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.findOne('assigned-1', clientNoCoach),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assigned workouts in the client reads', () => {
    it('lists own and assigned workouts, exposing only id and name of the coach', async () => {
      fake.db.workouts.push({
        ...workoutFixture({ id: 'self-2', userId: 'client-1' }).workouts[0],
      });
      const workouts = await service.findAll(clientOfCoach1);
      expect(workouts.map((w) => w.id).sort()).toEqual([
        'assigned-1',
        'self-2',
      ]);
      const assigned = workouts.find((w) => w.id === 'assigned-1');
      expect(assigned?.assignedById).toBe('coach-1');
      expect(assigned?.assignedBy).toEqual({
        id: 'coach-1',
        name: 'coach-1 name',
      });
      expect(workouts.find((w) => w.id === 'self-2')?.assignedBy).toBeNull();
    });

    it('findOne returns the trimmed coach on an assigned workout', async () => {
      const workout = await service.findOne('assigned-1', clientOfCoach1);
      expect(workout.assignedBy).toEqual({
        id: 'coach-1',
        name: 'coach-1 name',
      });
    });

    it('findUpcoming keeps future, not completed workouts', async () => {
      fake.workout('assigned-1')!.status = WorkoutStatus.COMPLETED;
      await expect(service.findUpcoming(clientOfCoach1)).resolves.toEqual([]);
    });
  });

  describe('create', () => {
    it('returns the new self-made workout with an empty card list', async () => {
      const result = await service.create(
        { name: 'New', date: '2026-10-03' },
        coach1,
      );
      expect(result).toMatchObject({
        name: 'New',
        userId: 'coach-1',
        assignedById: null,
        assignedBy: null,
        status: WorkoutStatus.PLANNED,
      });
      expect(result.exercises).toEqual([]);
    });

    it('never takes assignedById from the body', async () => {
      const dto = {
        name: 'Sneaky',
        date: '2026-10-03',
        assignedById: 'coach-1',
      } as CreateWorkoutDto;
      const result = await service.create(dto, clientOfCoach1);
      expect(result.assignedById).toBeNull();
    });
  });

  describe('update — cards in place', () => {
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

    it('numbers new sets without an order by their position and leaves them unlogged', async () => {
      await service.update(
        'workout-1',
        {
          exercises: [
            {
              exerciseId: 'global-1',
              order: 1,
              sets: [
                { reps: 1, weight: 1 },
                { reps: 2, weight: null },
              ],
            },
          ],
        },
        coach1,
      );
      const [card] = fake.cardsOf('workout-1');
      const sets = fake.db.sets.filter((s) => s.workoutExerciseId === card.id);
      expect(
        sets.map((s) => [s.order, s.weight, s.made, s.actualReps]),
      ).toEqual([
        [1, 1, null, null],
        [2, null, null, null],
      ]);
    });

    it('updates kept cards and sets by id, keeping results the body leaves out', async () => {
      await service.update(
        'workout-1',
        {
          exercises: [
            {
              id: 'workout-1-card-b',
              exerciseId: 'global-1',
              order: 1,
              sets: [{ id: 'workout-1-set-b1', reps: 9, weight: 11, order: 1 }],
            },
          ],
        },
        coach1,
      );
      expect(fake.set('workout-1-set-b1')).toMatchObject({
        workoutExerciseId: 'workout-1-card-b',
        reps: 9,
        weight: 11,
        made: true,
        actualReps: 6,
        actualWeight: 12.5,
        notes: 'slow',
      });
      expect(fake.cardsOf('workout-1')).toEqual([
        expect.objectContaining({
          id: 'workout-1-card-b',
          exerciseId: 'global-1',
          order: 1,
        }),
      ]);
      // Rows left out are deleted
      expect(fake.set('workout-1-set-b2')).toBeUndefined();
      expect(fake.set('workout-1-set-a1')).toBeUndefined();
    });

    it('writes the results the body sends, the tick included', async () => {
      await service.update(
        'workout-1',
        {
          exercises: [
            {
              id: 'workout-1-card-a',
              exerciseId: 'global-1',
              order: 1,
              sets: [
                {
                  id: 'workout-1-set-a1',
                  reps: 5,
                  weight: 100,
                  made: true,
                },
                { reps: 5, weight: 100, made: false, actualReps: 2 },
              ],
            },
            {
              id: 'workout-1-card-b',
              exerciseId: 'coach1-ex',
              order: 2,
              sets: [
                {
                  id: 'workout-1-set-b1',
                  reps: 8,
                  weight: 10,
                  made: null,
                  actualReps: null,
                  actualWeight: null,
                },
              ],
            },
          ],
        },
        coach1,
      );
      expect(fake.set('workout-1-set-a1')?.made).toBe(true);
      const newSet = fake.db.sets.find(
        (s) => s.workoutExerciseId === 'workout-1-card-a' && s.order === 2,
      );
      expect(newSet).toMatchObject({ made: false, actualReps: 2 });
      expect(fake.set('workout-1-set-b1')).toMatchObject({
        made: null,
        actualReps: null,
        actualWeight: null,
      });
    });

    it('recomputes totalWeightLifted over made sets, actual ?? planned', async () => {
      const result = await service.update(
        'workout-1',
        {
          exercises: [
            {
              exerciseId: 'global-1',
              order: 1,
              sets: [
                { reps: 5, weight: 100, made: true },
                { reps: 3, weight: 110, made: true, actualReps: 2 },
                { reps: 3, weight: 110, made: false },
                { reps: 3, weight: 110 },
              ],
            },
            {
              exerciseId: 'coach1-ex',
              order: 2,
              sets: [
                { reps: 10, weight: 22.5, made: true, actualWeight: 25 },
                { reps: 10, weight: null, made: true },
              ],
            },
          ],
        },
        coach1,
      );
      // 5*100 + 2*110 + 10*25 + 0
      expect(result.totalWeightLifted).toBe(970);
    });

    it('clears all cards and the total for an empty exercises list', async () => {
      fake.workout('workout-1')!.totalWeightLifted = 500;
      const result = await service.update(
        'workout-1',
        { exercises: [] },
        coach1,
      );
      expect(result.exercises).toEqual([]);
      expect(result.totalWeightLifted).toBe(0);
      expect(
        fake.db.sets.some((s) => String(s.id).startsWith('workout-1')),
      ).toBe(false);
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
      expect(fake.writes.filter((w) => w.entity !== 'Workout')).toEqual([]);
      expect(result.name).toBe('Renamed');
      expect(result.status).toBe(WorkoutStatus.COMPLETED);
      expect(cardSummary(result).map((c) => c.id)).toEqual([
        'workout-1-card-a',
        'workout-1-card-b',
      ]);
      expect(result.exercises[1].sets).toHaveLength(2);
    });

    it('updates only the fields sent, given a transformed DTO instance', async () => {
      const dto = plainToInstance(UpdateWorkoutDto, { name: 'Renamed' });
      await service.update('workout-1', dto, coach1);
      expect(fake.writes).toEqual([
        {
          op: 'update',
          entity: 'Workout',
          criteria: { id: 'workout-1' },
          values: { name: 'Renamed' },
        },
      ]);
    });

    it('runs every write in one transaction after locking the bare workout row', async () => {
      await service.update(
        'workout-1',
        { exercises: [{ exerciseId: 'global-1', order: 1, sets: [] }] },
        coach1,
      );
      expect(fake.manager.transaction).toHaveBeenCalledTimes(1);
      expectLockedFirst({ id: 'workout-1', userId: 'coach-1' });
    });

    it("404s on another user's workout without touching it", async () => {
      await expect(
        service.update('workout-1', { exercises: [] }, coach2),
      ).rejects.toBeInstanceOf(NotFoundException);
      noWrites();
    });
  });

  describe('update — card and set ids', () => {
    const attempt = (cards: WorkoutExerciseInput[]) =>
      service.update('workout-1', { exercises: cards }, coach1);

    it('keeps own card and set ids and creates rows without one', async () => {
      await attempt([
        {
          id: 'workout-1-card-b',
          exerciseId: 'coach1-ex',
          order: 1,
          sets: [
            { id: 'workout-1-set-b1', reps: 8, weight: 12, order: 1 },
            { reps: 8, weight: 14, order: 2 },
          ],
        },
      ]);
      const reloaded = await service.findOne('workout-1', coach1);
      expect(cardSummary(reloaded)).toEqual([
        {
          id: 'workout-1-card-b',
          exerciseId: 'coach1-ex',
          order: 1,
          sets: ['workout-1-set-b1', expect.stringMatching(/^gen-WorkoutSet/)],
        },
      ]);
      expect(reloaded.exercises[0].sets[0].weight).toBe(12);
    });

    it.each([
      [
        'a card id from another workout',
        [{ id: 'other-1-card-a', exerciseId: 'global-1', order: 1, sets: [] }],
      ],
      [
        'a set id from another workout',
        [
          {
            id: 'workout-1-card-a',
            exerciseId: 'global-1',
            order: 1,
            sets: [{ id: 'other-1-set-a1', reps: 5, weight: 100 }],
          },
        ],
      ],
      [
        'a set id that belongs to a different card of this workout',
        [
          {
            id: 'workout-1-card-a',
            exerciseId: 'global-1',
            order: 1,
            sets: [{ id: 'workout-1-set-b1', reps: 5, weight: 100 }],
          },
        ],
      ],
      [
        'an own set id placed on a new card (no id)',
        [
          {
            exerciseId: 'global-1',
            order: 1,
            sets: [{ id: 'workout-1-set-a1', reps: 5, weight: 100 }],
          },
        ],
      ],
      [
        'an id that exists nowhere',
        [
          {
            id: '55555555-5555-4555-8555-555555555555',
            exerciseId: 'global-1',
            order: 1,
            sets: [],
          },
        ],
      ],
      [
        'the same card id used twice',
        [
          {
            id: 'workout-1-card-a',
            exerciseId: 'global-1',
            order: 1,
            sets: [],
          },
          {
            id: 'workout-1-card-a',
            exerciseId: 'global-1',
            order: 2,
            sets: [],
          },
        ],
      ],
      [
        'the same set id used twice',
        [
          {
            id: 'workout-1-card-b',
            exerciseId: 'coach1-ex',
            order: 1,
            sets: [
              { id: 'workout-1-set-b1', reps: 5, weight: 100 },
              { id: 'workout-1-set-b1', reps: 5, weight: 100 },
            ],
          },
        ],
      ],
    ] as [string, WorkoutExerciseInput[]][])(
      'rejects %s and changes nothing',
      async (_label, cards) => {
        await expect(attempt(cards)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        noWrites();
      },
    );
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
      noWrites();
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
      fake.workout('workout-1')!.userId = 'client-1';
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

  describe('assigned workouts — client writes', () => {
    it('lets the client change only the status', async () => {
      const result = await service.update(
        'assigned-1',
        plainToInstance(UpdateWorkoutDto, { status: 'COMPLETED' }),
        clientOfCoach1,
      );
      expect(result.status).toBe(WorkoutStatus.COMPLETED);
      expect(fake.writes).toEqual([
        {
          op: 'update',
          entity: 'Workout',
          criteria: { id: 'assigned-1' },
          values: { status: 'COMPLETED' },
        },
      ]);
    });

    it.each([
      ['name', { name: 'Mine now' }],
      ['date', { date: '2030-02-02' }],
      ['notes', { notes: 'x' }],
      ['exercises', { exercises: [] }],
      ['status plus name', { status: 'COMPLETED', name: 'x' }],
    ])('403s on a %s change and writes nothing', async (_label, body) => {
      await expect(
        service.update(
          'assigned-1',
          plainToInstance(UpdateWorkoutDto, body),
          clientOfCoach1,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      noWrites();
      expect(fake.cardsOf('assigned-1')).toHaveLength(2);
    });

    it('403s on DELETE of an assigned workout and keeps it', async () => {
      await expect(
        service.remove('assigned-1', clientOfCoach1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fake.workout('assigned-1')).toBeDefined();
      noWrites();
    });

    it("404s on another client's assigned workout", async () => {
      await expect(
        service.update(
          'assigned-1',
          plainToInstance(UpdateWorkoutDto, { status: 'COMPLETED' }),
          clientNoCoach,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.remove('assigned-1', clientNoCoach),
      ).rejects.toBeInstanceOf(NotFoundException);
      noWrites();
    });
  });

  describe('remove', () => {
    it('deletes an own self-made workout with its cards and sets, under the row lock', async () => {
      await service.remove('workout-1', coach1);
      expect(fake.workout('workout-1')).toBeUndefined();
      expect(fake.cardsOf('workout-1')).toEqual([]);
      expectLockedFirst({ id: 'workout-1', userId: 'coach-1' });
    });

    it("404s on another user's workout", async () => {
      await expect(service.remove('workout-1', coach2)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fake.workout('workout-1')).toBeDefined();
    });
  });

  describe('addSet', () => {
    it("appends a set after the card's last set on an assigned workout", async () => {
      const set = await service.addSet(
        'assigned-1',
        'assigned-1-card-b',
        { reps: 4, weight: 30 },
        clientOfCoach1,
      );
      expect(set).toMatchObject({
        workoutExerciseId: 'assigned-1-card-b',
        reps: 4,
        weight: 30,
        order: 3,
        made: null,
        actualReps: null,
        actualWeight: null,
        notes: null,
      });
      expect(fake.workout('assigned-1')?.status).toBe(WorkoutStatus.PLANNED);
      expectLockedFirst({ id: 'assigned-1', userId: 'client-1' });
    });

    it('works on a self-made workout and defaults weight to null', async () => {
      const set = await service.addSet(
        'workout-1',
        'workout-1-card-a',
        { reps: 4 },
        coach1,
      );
      expect(set).toMatchObject({ order: 2, weight: null });
    });

    it('starts a planned workout and counts a set added as made', async () => {
      await service.addSet(
        'assigned-1',
        'assigned-1-card-a',
        { reps: 5, weight: 40, made: true, actualReps: 4 },
        clientOfCoach1,
      );
      const workout = fake.workout('assigned-1');
      expect(workout?.status).toBe(WorkoutStatus.IN_PROGRESS);
      // set-b1 (6 × 12.5) + the new set (4 × 40)
      expect(workout?.totalWeightLifted).toBe(235);
    });

    it("404s on another client's workout and writes nothing", async () => {
      await expect(
        service.addSet(
          'assigned-1',
          'assigned-1-card-a',
          { reps: 5 },
          clientNoCoach,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      noWrites();
    });

    it('404s on a card that is not on the workout', async () => {
      await expect(
        service.addSet(
          'assigned-1',
          'other-1-card-a',
          { reps: 5 },
          clientOfCoach1,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      noWrites();
    });
  });

  describe('updateSetResult', () => {
    it('writes only the result columns and starts a planned workout', async () => {
      const set = await service.updateSetResult(
        'assigned-1',
        'assigned-1-set-a1',
        { actualReps: 3, actualWeight: 105, made: true },
        clientOfCoach1,
      );
      expect(set).toMatchObject({
        reps: 5,
        weight: 100,
        made: true,
        actualReps: 3,
        actualWeight: 105,
      });
      const setWrites = fake.writes.filter((w) => w.entity === 'WorkoutSet');
      expect(setWrites).toEqual([
        {
          op: 'update',
          entity: 'WorkoutSet',
          criteria: { id: 'assigned-1-set-a1' },
          values: { made: true, actualReps: 3, actualWeight: 105 },
        },
      ]);
      const workout = fake.workout('assigned-1');
      expect(workout?.status).toBe(WorkoutStatus.IN_PROGRESS);
      // 3 × 105 + set-b1 (6 × 12.5)
      expect(workout?.totalWeightLifted).toBe(390);
      expectLockedFirst({ id: 'assigned-1', userId: 'client-1' });
    });

    it('clears a result sent as null and leaves other fields alone', async () => {
      await service.updateSetResult(
        'assigned-1',
        'assigned-1-set-b1',
        { made: null },
        clientOfCoach1,
      );
      expect(fake.set('assigned-1-set-b1')).toMatchObject({
        made: null,
        actualReps: 6,
        actualWeight: 12.5,
      });
      expect(fake.workout('assigned-1')?.totalWeightLifted).toBe(0);
    });

    it('leaves a planned workout planned when the body logs nothing', async () => {
      await service.updateSetResult(
        'assigned-1',
        'assigned-1-set-a1',
        {},
        clientOfCoach1,
      );
      expect(fake.workout('assigned-1')?.status).toBe(WorkoutStatus.PLANNED);
      expect(fake.writes.filter((w) => w.entity === 'WorkoutSet')).toEqual([]);
    });

    it('leaves a completed workout completed', async () => {
      fake.workout('assigned-1')!.status = WorkoutStatus.COMPLETED;
      await service.updateSetResult(
        'assigned-1',
        'assigned-1-set-a1',
        { made: false },
        clientOfCoach1,
      );
      expect(fake.workout('assigned-1')?.status).toBe(WorkoutStatus.COMPLETED);
    });

    it("404s on another client's workout", async () => {
      await expect(
        service.updateSetResult(
          'assigned-1',
          'assigned-1-set-a1',
          { made: true },
          clientNoCoach,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      noWrites();
    });

    it('404s on a set that is not on the workout', async () => {
      await expect(
        service.updateSetResult(
          'assigned-1',
          'other-1-set-a1',
          { made: true },
          clientOfCoach1,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      noWrites();
    });
  });
});
