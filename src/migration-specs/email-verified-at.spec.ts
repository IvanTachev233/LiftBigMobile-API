import { QueryRunner } from 'typeorm';
import { EmailVerifiedAt1709800000008 } from '../migrations/1709800000008-EmailVerifiedAt';

// Lives outside src/migrations, whose glob loads every .ts file as a
// migration. The data itself is checked against a copy of a real database.
function fakeRunner(tables: string[]) {
  const query = jest.fn().mockResolvedValue([]);
  const runner = {
    hasTable: jest.fn((name: string) => Promise.resolve(tables.includes(name))),
    query,
  };
  return { runner: runner as unknown as QueryRunner, query };
}

function sql(query: jest.Mock): string[] {
  return query.mock.calls.map(([text]) => String(text).replace(/\s+/g, ' '));
}

describe('EmailVerifiedAt1709800000008', () => {
  const migration = new EmailVerifiedAt1709800000008();

  it('does nothing on a fresh database without the user table', async () => {
    const { runner, query } = fakeRunner([]);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('adds the column if missing, then marks every existing account verified', async () => {
    const { runner, query } = fakeRunner(['user']);
    await migration.up(runner);
    expect(sql(query)).toEqual([
      'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP',
      'UPDATE "user" SET "emailVerifiedAt" = now() WHERE "emailVerifiedAt" IS NULL',
    ]);
  });

  it('down does nothing without the user table', async () => {
    const { runner, query } = fakeRunner([]);
    await migration.down(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('down drops the column', async () => {
    const { runner, query } = fakeRunner(['user']);
    await migration.down(runner);
    expect(sql(query)).toEqual([
      'ALTER TABLE "user" DROP COLUMN IF EXISTS "emailVerifiedAt"',
    ]);
  });
});
