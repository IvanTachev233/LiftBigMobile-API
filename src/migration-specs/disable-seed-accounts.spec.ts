import { QueryRunner } from 'typeorm';
import { DisableSeedAccounts1709800000011 } from '../migrations/1709800000011-DisableSeedAccounts';

// Lives outside src/migrations, whose glob loads every .ts file as a
// migration. Sign-in after the migration is checked in
// test/disable-seed-accounts.e2e-spec.ts.
function fakeRunner(tables: string[]) {
  const query = jest.fn().mockResolvedValue([]);
  const runner = {
    hasTable: jest.fn((name: string) => Promise.resolve(tables.includes(name))),
    query,
  };
  return { runner: runner as unknown as QueryRunner, query };
}

function calls(query: jest.Mock): [string, unknown][] {
  return query.mock.calls.map(([text, parameters]) => [
    String(text).replace(/\s+/g, ' ').trim(),
    parameters,
  ]);
}

describe('DisableSeedAccounts1709800000011', () => {
  const migration = new DisableSeedAccounts1709800000011();

  it('does nothing on a fresh database without the user table', async () => {
    const { runner, query } = fakeRunner([]);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('makes the seed passwords unusable and revokes their tokens', async () => {
    const { runner, query } = fakeRunner(['user']);
    await migration.up(runner);
    expect(calls(query)).toEqual([
      [
        'UPDATE "user" SET "passwordHash" = $1, "tokenVersion" = "tokenVersion" + 1 WHERE "email" IN ($2, $3, $4)',
        [
          '!deleted',
          'mockuser@liftbig.com',
          'mockuser_specific@liftbig.com',
          'coach@liftbig.com',
        ],
      ],
    ]);
  });

  it('down leaves the accounts disabled', async () => {
    const { runner, query } = fakeRunner(['user']);
    await migration.down(runner);
    expect(query).not.toHaveBeenCalled();
  });
});
