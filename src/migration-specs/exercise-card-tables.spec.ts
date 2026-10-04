import { QueryRunner } from 'typeorm';
import { ExerciseCardTables1709800000006 } from '../migrations/1709800000006-ExerciseCardTables';

// Lives outside src/migrations, whose glob loads every .ts file as a
// migration. The data itself is checked against a copy of a real database.
function fakeRunner(tables: string[], columns: Record<string, string[]> = {}) {
  const query = jest.fn().mockResolvedValue([{ conname: 'PK_old' }]);
  const runner = {
    hasTable: jest.fn((name: string) => Promise.resolve(tables.includes(name))),
    hasColumn: jest.fn((table: string, column: string) =>
      Promise.resolve((columns[table] ?? []).includes(column)),
    ),
    query,
  };
  return { runner: runner as unknown as QueryRunner, query };
}

function sql(query: jest.Mock): string[] {
  return query.mock.calls.map(([text]) => String(text));
}

describe('ExerciseCardTables1709800000006', () => {
  const migration = new ExerciseCardTables1709800000006();

  it('does nothing on a fresh database without the set tables', async () => {
    const { runner, query } = fakeRunner([]);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('does nothing when the card schema already exists', async () => {
    const { runner, query } = fakeRunner(
      ['workout_set', 'program_exercise', 'program_set'],
      { workout_set: ['workoutExerciseId'] },
    );
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('migrates only the workouts when the program tables are already new', async () => {
    const { runner, query } = fakeRunner(
      ['workout_set', 'program_exercise', 'program_set'],
      { workout_set: ['workoutId'] },
    );
    await migration.up(runner);
    const statements = sql(query);
    expect(
      statements.some((s) => s.includes('CREATE TABLE "workout_exercise"')),
    ).toBe(true);
    expect(statements.some((s) => s.includes('RENAME TO "program_set"'))).toBe(
      false,
    );
  });

  it('migrates both when the old flat tables exist', async () => {
    const { runner, query } = fakeRunner(['workout_set', 'program_exercise']);
    await migration.up(runner);
    const statements = sql(query);
    expect(
      statements.some((s) => s.includes('CREATE TABLE "workout_exercise"')),
    ).toBe(true);
    expect(statements.some((s) => s.includes('RENAME TO "program_set"'))).toBe(
      true,
    );
    expect(
      statements.some((s) => s.includes('"exercise_card_migration_set_order"')),
    ).toBe(true);
  });

  it('adds a missing supersetGroup column before grouping the old sets', async () => {
    const { runner, query } = fakeRunner(['workout_set', 'program_exercise']);
    await migration.up(runner);
    const statements = sql(query);
    const addWorkoutColumn = statements.findIndex((s) =>
      s.includes(
        'ALTER TABLE "workout_set" ADD COLUMN IF NOT EXISTS "supersetGroup" uuid',
      ),
    );
    const groupWorkouts = statements.findIndex((s) =>
      s.includes('INSERT INTO "workout_exercise"'),
    );
    const addProgramColumn = statements.findIndex((s) =>
      s.includes(
        'ALTER TABLE "program_exercise" ADD COLUMN IF NOT EXISTS "supersetGroup" uuid',
      ),
    );
    const renamePrograms = statements.findIndex((s) =>
      s.includes('RENAME TO "program_set"'),
    );
    expect(addWorkoutColumn).toBeGreaterThanOrEqual(0);
    expect(addWorkoutColumn).toBeLessThan(groupWorkouts);
    expect(addProgramColumn).toBeGreaterThanOrEqual(0);
    expect(addProgramColumn).toBeLessThan(renamePrograms);
  });

  it('down does nothing when the card schema is absent', async () => {
    const { runner, query } = fakeRunner(['workout_set', 'program_exercise']);
    await migration.down(runner);
    expect(query).not.toHaveBeenCalled();
  });
});
