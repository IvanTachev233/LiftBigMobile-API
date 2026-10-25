import { QueryRunner } from 'typeorm';
import { PolicyRecords1709800000010 } from '../migrations/1709800000010-PolicyRecords';

// Lives outside src/migrations, whose glob loads every .ts file as a
// migration. The DDL itself is checked against a copy of a real database.
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

describe('PolicyRecords1709800000010', () => {
  const migration = new PolicyRecords1709800000010();

  it('does nothing on a fresh database without the user table', async () => {
    const { runner, query } = fakeRunner([]);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('creates only the tables synchronize has not created yet', async () => {
    const { runner, query } = fakeRunner([
      'user',
      'policy_acceptance',
      'consent_event',
    ]);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('creates both tables, their user indexes and foreign keys', async () => {
    const { runner, query } = fakeRunner(['user']);
    await migration.up(runner);
    const statements = sql(query);
    expect(statements).toHaveLength(6);
    expect(statements[0]).toMatch(/^CREATE TABLE "policy_acceptance" \(/);
    expect(statements[0]).toContain(
      'CONSTRAINT "PK_f1cade691bebad842497ce27c34" PRIMARY KEY ("id")',
    );
    expect(statements[3]).toMatch(/^CREATE TABLE "consent_event" \(/);
    expect(statements[3]).toContain(
      'CONSTRAINT "PK_da129f04a16b45855a0ebb5ed68" PRIMARY KEY ("id")',
    );
    expect([
      statements[1],
      statements[2],
      statements[4],
      statements[5],
    ]).toEqual([
      'CREATE INDEX "IDX_9f4bc360bf0a095ab39282faac" ON "policy_acceptance" ("userId")',
      'ALTER TABLE "policy_acceptance" ADD CONSTRAINT "FK_9f4bc360bf0a095ab39282faac3" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
      'CREATE INDEX "IDX_4d5a51cd2e1b0324ea4abff71c" ON "consent_event" ("userId")',
      'ALTER TABLE "consent_event" ADD CONSTRAINT "FK_4d5a51cd2e1b0324ea4abff71c6" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    ]);
    expect(statements.every((s) => /^(CREATE|ALTER TABLE)/.test(s))).toBe(true);
  });

  it('down drops both tables', async () => {
    const { runner, query } = fakeRunner([
      'user',
      'policy_acceptance',
      'consent_event',
    ]);
    await migration.down(runner);
    expect(sql(query)).toEqual([
      'DROP TABLE IF EXISTS "consent_event"',
      'DROP TABLE IF EXISTS "policy_acceptance"',
    ]);
  });
});
