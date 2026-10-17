import { QueryRunner } from 'typeorm';
import { AuthSessions1709800000009 } from '../migrations/1709800000009-AuthSessions';

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

describe('AuthSessions1709800000009', () => {
  const migration = new AuthSessions1709800000009();

  it('does nothing on a fresh database without the user table', async () => {
    const { runner, query } = fakeRunner([]);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('does nothing when synchronize already created the table', async () => {
    const { runner, query } = fakeRunner(['user', 'auth_session']);
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('creates the table, its indexes and the user foreign key', async () => {
    const { runner, query } = fakeRunner(['user']);
    await migration.up(runner);
    const statements = sql(query);
    expect(statements).toHaveLength(5);
    expect(statements[0]).toMatch(/^CREATE TABLE "auth_session" \(/);
    expect(statements[0]).toContain(
      'CONSTRAINT "PK_19354ed146424a728c1112a8cbf" PRIMARY KEY ("id")',
    );
    expect(statements.slice(1)).toEqual([
      'CREATE INDEX "IDX_c072b729d71697f959bde66ade" ON "auth_session" ("userId")',
      'CREATE UNIQUE INDEX "IDX_91b0ea197ef5e65be48c624aae" ON "auth_session" ("tokenHash")',
      'CREATE INDEX "IDX_79479d08ea0f7a335991a846fa" ON "auth_session" ("previousHash")',
      'ALTER TABLE "auth_session" ADD CONSTRAINT "FK_c072b729d71697f959bde66ade0" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    ]);
  });

  it('down drops the table', async () => {
    const { runner, query } = fakeRunner(['user', 'auth_session']);
    await migration.down(runner);
    expect(sql(query)).toEqual(['DROP TABLE IF EXISTS "auth_session"']);
  });
});
