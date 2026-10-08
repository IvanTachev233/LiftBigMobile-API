import { DataSource, DefaultNamingStrategy, QueryRunner } from 'typeorm';
import { AssignedWorkouts1709800000007 } from '../migrations/1709800000007-AssignedWorkouts';
import { Workout } from '../workouts/entities/workout.entity';
import { WorkoutExercise } from '../workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../workouts/entities/workout-set.entity';
import { Exercise } from '../workouts/entities/exercise.entity';
import { User } from '../auth/user.entity';
import { programEntities } from '../programs/entities';

// Lives outside src/migrations, whose glob loads every .ts file as a
// migration. The data itself is checked against copies of real databases.
const BACKUP_TABLES = [
  'assigned_workout_migration_sets',
  'assigned_workout_migration_workouts',
  'assigned_workout_migration_programs',
];

type Collisions = {
  workouts: number;
  cards: number;
  sets: number;
  oversized?: number;
};

function fakeRunner(
  tables: string[],
  collisions: Collisions = { workouts: 0, cards: 0, sets: 0, oversized: 0 },
) {
  const query = jest.fn().mockResolvedValue([collisions]);
  const runner = {
    hasTable: jest.fn((name: string) => Promise.resolve(tables.includes(name))),
    query,
  };
  return { runner: runner as unknown as QueryRunner, query };
}

function sql(query: jest.Mock): string[] {
  return query.mock.calls.map(([text]) => String(text).replace(/\s+/g, ' '));
}

function indexOf(statements: string[], fragment: string): number {
  return statements.findIndex((s) => s.includes(fragment));
}

const WRITE = /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i;

async function workoutMetadata() {
  const dataSource = new DataSource({
    type: 'postgres',
    entities: [
      Workout,
      WorkoutExercise,
      WorkoutSet,
      Exercise,
      User,
      ...programEntities,
    ],
  });
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource.getMetadata(Workout);
}

describe('AssignedWorkouts1709800000007', () => {
  const migration = new AssignedWorkouts1709800000007();
  const preMigrationTables = [
    'program',
    'program_exercise',
    'program_set',
    'workout',
    'workout_exercise',
    'workout_set',
  ];

  it('throws before any write when an actualWeight does not fit numeric(6,2)', async () => {
    const { runner, query } = fakeRunner(preMigrationTables, {
      workouts: 0,
      cards: 0,
      sets: 0,
      oversized: 2,
    });
    await expect(migration.up(runner)).rejects.toThrow(/actualWeight/);
    expect(sql(query).filter((s) => WRITE.test(s))).toEqual([]);
  });

  it('does nothing on a fresh database without the program table', async () => {
    const { runner, query } = fakeRunner(['workout', 'workout_set']);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['program id is a workout id', { workouts: 1, cards: 0, sets: 0 }],
    [
      'program card id is a workout card id',
      { workouts: 0, cards: 2, sets: 0 },
    ],
    ['program set id is a workout set id', { workouts: 0, cards: 0, sets: 1 }],
  ])('throws before any write when a %s', async (_label, collisions) => {
    const { runner, query } = fakeRunner(preMigrationTables, collisions);
    await expect(migration.up(runner)).rejects.toThrow(/collid/i);
    expect(query).toHaveBeenCalled();
    expect(sql(query).filter((s) => WRITE.test(s))).toEqual([]);
  });

  it('checks for collisions before the first write', async () => {
    const { runner, query } = fakeRunner(preMigrationTables);
    await migration.up(runner);
    const statements = sql(query);
    const firstWrite = statements.findIndex((s) => WRITE.test(s));
    expect(firstWrite).toBeGreaterThan(0);
    expect(statements[0]).toContain('"program"');
    expect(statements[0]).toContain('"workout_set"');
  });

  it('copies programs, cards and sets by id, then drops the program tables', async () => {
    const { runner, query } = fakeRunner(preMigrationTables);
    await migration.up(runner);
    const statements = sql(query);
    const copyWorkouts = statements.findIndex(
      (s) =>
        s.startsWith('INSERT INTO "workout" ') && s.includes('FROM "program" '),
    );
    const copyCards = statements.findIndex(
      (s) =>
        s.startsWith('INSERT INTO "workout_exercise" ') &&
        s.includes('FROM "program_exercise"'),
    );
    const copySets = statements.findIndex(
      (s) =>
        s.startsWith('INSERT INTO "workout_set" ') &&
        s.includes('FROM "program_set"'),
    );
    const dropPrograms = indexOf(statements, 'DROP TABLE "program_set"');
    expect(copyWorkouts).toBeGreaterThanOrEqual(0);
    expect(copyCards).toBeGreaterThan(copyWorkouts);
    expect(copySets).toBeGreaterThan(copyCards);
    expect(dropPrograms).toBeGreaterThan(copySets);
    expect(statements[copyWorkouts]).toContain('"assignedById"');
  });

  it('backs up dropped values before dropping them', async () => {
    const { runner, query } = fakeRunner(preMigrationTables);
    await migration.up(runner);
    const statements = sql(query);
    for (const table of BACKUP_TABLES) {
      expect(indexOf(statements, `CREATE TABLE "${table}"`)).toBeGreaterThan(0);
    }
    const backupSets = indexOf(statements, `INSERT INTO "${BACKUP_TABLES[0]}"`);
    const backupPrograms = indexOf(
      statements,
      `INSERT INTO "${BACKUP_TABLES[2]}"`,
    );
    expect(backupSets).toBeGreaterThan(0);
    expect(backupSets).toBeLessThan(
      indexOf(statements, 'DROP COLUMN "isCompleted"'),
    );
    expect(backupPrograms).toBeGreaterThan(0);
    expect(backupPrograms).toBeLessThan(
      indexOf(statements, 'DROP TABLE "program"'),
    );
  });

  it('maps ticked self sets to made before dropping isCompleted', async () => {
    const { runner, query } = fakeRunner(preMigrationTables);
    await migration.up(runner);
    const statements = sql(query);
    const setMade = statements.findIndex(
      (s) =>
        s.startsWith('UPDATE "workout_set"') && s.includes('"isCompleted"'),
    );
    expect(setMade).toBeGreaterThan(0);
    expect(setMade).toBeLessThan(
      indexOf(statements, 'DROP COLUMN "isCompleted"'),
    );
    expect(
      indexOf(statements, 'DROP TYPE "workout_set_weightmode_enum"'),
    ).toBeGreaterThan(0);
  });

  it('adds assignedById with the foreign key name sync derives', async () => {
    const metadata = await workoutMetadata();
    const fk = metadata.foreignKeys.find((f) =>
      f.columnNames.includes('assignedById'),
    );
    expect(fk?.name).toBeTruthy();
    const { runner, query } = fakeRunner(preMigrationTables);
    await migration.up(runner);
    expect(
      sql(query).some((s) =>
        s.includes(
          `CONSTRAINT "${fk?.name}" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE SET NULL`,
        ),
      ),
    ).toBe(true);
  });

  it('recomputes every total after copying the program sets', async () => {
    const { runner, query } = fakeRunner(preMigrationTables);
    await migration.up(runner);
    const statements = sql(query);
    const recompute = statements.findIndex(
      (s) =>
        s.startsWith('UPDATE "workout"') && s.includes('"totalWeightLifted"'),
    );
    expect(recompute).toBeGreaterThan(
      statements.findIndex((s) => s.startsWith('INSERT INTO "workout_set" ')),
    );
  });

  it('down does nothing without the backup tables', async () => {
    const { runner, query } = fakeRunner(['workout', 'workout_set']);
    await migration.down(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('down moves assigned workouts back under the original constraint names', async () => {
    const naming = new DefaultNamingStrategy();
    const { runner, query } = fakeRunner([
      'workout',
      'workout_exercise',
      'workout_set',
      ...BACKUP_TABLES,
    ]);
    await migration.down(runner);
    const statements = sql(query);
    const restorePrograms = statements.findIndex(
      (s) =>
        s.startsWith('INSERT INTO "program" ') &&
        s.includes('"assignedById" IS NOT NULL'),
    );
    const deleteAssigned = statements.findIndex(
      (s) =>
        s.startsWith('DELETE FROM "workout"') &&
        s.includes('"assignedById" IS NOT NULL'),
    );
    expect(restorePrograms).toBeGreaterThan(0);
    expect(deleteAssigned).toBeGreaterThan(
      statements.findIndex((s) => s.startsWith('INSERT INTO "program_set" ')),
    );
    const all = statements.join('\n');
    expect(all).toContain(naming.primaryKeyName('program', ['id']));
    expect(all).toContain(
      naming.foreignKeyName('program', ['clientId'], 'user', ['id']),
    );
    expect(all).toContain(
      naming.foreignKeyName('program', ['coachId'], 'user', ['id']),
    );
    expect(all).toContain('CREATE TYPE "workout_set_weightmode_enum"');
    for (const table of BACKUP_TABLES) {
      expect(indexOf(statements, `DROP TABLE "${table}"`)).toBeGreaterThan(
        deleteAssigned,
      );
    }
  });
});
