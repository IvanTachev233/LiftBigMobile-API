import { FindOperator } from 'typeorm';
import { Workout } from '../src/workouts/entities/workout.entity';
import { WorkoutExercise } from '../src/workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../src/workouts/entities/workout-set.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { User } from '../src/auth/user.entity';

export type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;
type Target = typeof Workout | typeof WorkoutExercise | typeof WorkoutSet;

export interface WriteRecord {
  op: 'insert' | 'update' | 'delete';
  entity: string;
  criteria?: unknown;
  values?: Row | Record<string, unknown>;
}

export interface LockRecord {
  entity: string;
  where: Where;
  lock?: { mode: string };
  relations?: unknown;
}

export interface FakeTables {
  workouts: Row[];
  cards: Row[];
  sets: Row[];
  users: Row[];
  exercises: Exercise[];
}

const clone = <T>(rows: T[]): T[] => rows.map((row) => ({ ...row }));

// In-memory stand-in for the workout, card, set and user tables behind a
// TypeORM EntityManager and repositories. Reads return copies in storage
// order, so sorting has to come from the code under test. A transaction
// restores every table when its callback throws.
export function createFakeWorkoutDb(
  initial: FakeTables,
  exerciseRepo: unknown = {},
) {
  const db: FakeTables = initial;
  const writes: WriteRecord[] = [];
  const reads: LockRecord[] = [];
  let seq = 0;

  const name = (target: unknown) => (target as { name: string }).name;

  const tableOf = (target: unknown): Row[] => {
    if (target === Workout) return db.workouts;
    if (target === WorkoutExercise) return db.cards;
    if (target === WorkoutSet) return db.sets;
    if (target === User) return db.users;
    throw new Error(`No fake table for ${name(target)}`);
  };

  const matches = (row: Row, where: Where): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (key === 'workoutExercise') {
        const card = db.cards.find((c) => c.id === row.workoutExerciseId);
        return !!card && matches(card, expected as Where);
      }
      const actual = row[key];
      if (expected instanceof FindOperator) {
        if (expected.type === 'not') return actual !== expected.value;
        if (expected.type === 'moreThanOrEqual') {
          return (
            new Date(actual as string).getTime() >=
            new Date(expected.value as Date).getTime()
          );
        }
        throw new Error(`Unsupported operator ${expected.type}`);
      }
      return actual === expected;
    });

  const setsOf = (cardId: string) =>
    clone(db.sets.filter((s) => s.workoutExerciseId === cardId));

  const joinedWorkout = (row: Row): Workout => {
    const assignedBy = db.users.find((u) => u.id === row.assignedById);
    return {
      ...row,
      assignedBy: assignedBy ? { ...assignedBy } : null,
      exercises: db.cards
        .filter((c) => c.workoutId === row.id)
        .map((c) => ({
          ...c,
          exercise: db.exercises.find((e) => e.id === c.exerciseId),
          sets: setsOf(c.id),
        })),
    } as unknown as Workout;
  };

  const find = (
    target: unknown,
    opts: { where?: Where; relations?: unknown },
  ) => {
    const rows = tableOf(target).filter((r) => matches(r, opts.where ?? {}));
    if (target === WorkoutExercise && opts.relations) {
      return rows.map((c) => ({ ...c, sets: setsOf(c.id) }));
    }
    return clone(rows);
  };

  const deleteRows = (target: unknown, criteria: unknown) => {
    const table = tableOf(target);
    const doomed = table.filter((r) =>
      Array.isArray(criteria)
        ? criteria.includes(r.id)
        : typeof criteria === 'string'
          ? r.id === criteria
          : matches(r, criteria as Where),
    );
    for (const row of doomed) {
      table.splice(table.indexOf(row), 1);
      // ON DELETE CASCADE
      if (target === Workout) {
        deleteRows(
          WorkoutExercise,
          db.cards.filter((c) => c.workoutId === row.id).map((c) => c.id),
        );
      }
      if (target === WorkoutExercise) {
        deleteRows(
          WorkoutSet,
          db.sets
            .filter((s) => s.workoutExerciseId === row.id)
            .map((s) => s.id),
        );
      }
    }
    return doomed.length;
  };

  const manager = {
    getRepository: jest.fn((target: unknown) => {
      if (target === Exercise) return exerciseRepo;
      throw new Error(`No fake repository for ${name(target)}`);
    }),
    transaction: jest.fn(
      async (cb: (m: object) => Promise<unknown>): Promise<unknown> => {
        const snapshot = {
          workouts: clone(db.workouts),
          cards: clone(db.cards),
          sets: clone(db.sets),
          users: clone(db.users),
        };
        try {
          return await cb(manager);
        } catch (err) {
          Object.assign(db, snapshot);
          throw err;
        }
      },
    ),
    find: jest.fn(
      (target: Target, opts: { where?: Where; relations?: unknown }) =>
        Promise.resolve(find(target, opts)),
    ),
    findOne: jest.fn(
      (
        target: Target,
        opts: { where: Where; lock?: { mode: string }; relations?: unknown },
      ) => {
        reads.push({
          entity: name(target),
          where: opts.where,
          lock: opts.lock,
          relations: opts.relations,
        });
        return Promise.resolve(find(target, opts)[0] ?? null);
      },
    ),
    findOneOrFail: jest.fn((target: Target, opts: { where: Where }) => {
      const row = find(target, opts)[0];
      return row
        ? Promise.resolve(row)
        : Promise.reject(new Error(`${name(target)} not found`));
    }),
    count: jest.fn((target: unknown, opts: { where: Where }) =>
      Promise.resolve(
        tableOf(target).filter((r) => matches(r, opts.where)).length,
      ),
    ),
    insert: jest.fn((target: Target, values: Record<string, unknown>) => {
      const row = { ...values } as Row;
      row.id ??= `gen-${name(target)}-${++seq}`;
      tableOf(target).push(row);
      writes.push({ op: 'insert', entity: name(target), values: { ...row } });
      return Promise.resolve({ identifiers: [{ id: row.id }] });
    }),
    update: jest.fn(
      (target: Target, criteria: Where, values: Record<string, unknown>) => {
        const rows = tableOf(target).filter((r) => matches(r, criteria));
        for (const row of rows) Object.assign(row, values);
        writes.push({
          op: 'update',
          entity: name(target),
          criteria,
          values: { ...values },
        });
        return Promise.resolve({ affected: rows.length });
      },
    ),
    delete: jest.fn((target: Target, criteria: unknown) => {
      writes.push({ op: 'delete', entity: name(target), criteria });
      return Promise.resolve({ affected: deleteRows(target, criteria) });
    }),
  };

  const workoutRepo = {
    manager,
    find: jest.fn((opts: { where: Where }) =>
      Promise.resolve(
        db.workouts.filter((w) => matches(w, opts.where)).map(joinedWorkout),
      ),
    ),
    findOne: jest.fn((opts: { where: Where }) => {
      const row = db.workouts.find((w) => matches(w, opts.where));
      return Promise.resolve(row ? joinedWorkout(row) : null);
    }),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((data: Record<string, unknown>) => {
      const row = { ...data, id: `gen-Workout-${++seq}` } as Row;
      db.workouts.push(row);
      writes.push({ op: 'insert', entity: 'Workout', values: { ...row } });
      return Promise.resolve({ ...row });
    }),
  };

  const set = (id: string) => db.sets.find((s) => s.id === id);
  const workout = (id: string) => db.workouts.find((w) => w.id === id);
  const cardsOf = (workoutId: string) =>
    db.cards.filter((c) => c.workoutId === workoutId);

  return { db, writes, reads, manager, workoutRepo, set, workout, cardsOf };
}

export type FakeWorkoutDb = ReturnType<typeof createFakeWorkoutDb>;

// Two cards stored out of order, with sets out of order; card-b's first set
// is logged.
export function workoutFixture(
  overrides: Partial<Row> & { id: string; userId: string },
): Pick<FakeTables, 'workouts' | 'cards' | 'sets'> {
  const id = overrides.id;
  return {
    workouts: [
      {
        name: 'Push',
        date: new Date('2030-01-01T00:00:00Z'),
        notes: null,
        isTemplate: false,
        status: 'PLANNED',
        totalWeightLifted: 0,
        assignedById: null,
        ...overrides,
      },
    ],
    cards: [
      {
        id: `${id}-card-b`,
        workoutId: id,
        exerciseId: 'coach1-ex',
        order: 2,
        supersetGroup: null,
      },
      {
        id: `${id}-card-a`,
        workoutId: id,
        exerciseId: 'global-1',
        order: 1,
        supersetGroup: null,
      },
    ],
    sets: [
      {
        id: `${id}-set-b2`,
        workoutExerciseId: `${id}-card-b`,
        reps: 8,
        weight: 20,
        order: 2,
        made: null,
        actualReps: null,
        actualWeight: null,
        notes: null,
      },
      {
        id: `${id}-set-b1`,
        workoutExerciseId: `${id}-card-b`,
        reps: 8,
        weight: 10,
        order: 1,
        made: true,
        actualReps: 6,
        actualWeight: 12.5,
        notes: 'slow',
      },
      {
        id: `${id}-set-a1`,
        workoutExerciseId: `${id}-card-a`,
        reps: 5,
        weight: 100,
        order: 1,
        made: null,
        actualReps: null,
        actualWeight: null,
        notes: null,
      },
    ],
  };
}
