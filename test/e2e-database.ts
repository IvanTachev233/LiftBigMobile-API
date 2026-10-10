import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { databaseConfig } from '../src/config/database.config';

export const E2E_DATABASE = 'liftbig_e2e';

// Same server as local dev (DB_* variables, defaults to the postgres
// container on 5433), with the database swapped.
function serverOptions(database: string): PostgresConnectionOptions {
  if (process.env.DATABASE_URL) {
    throw new Error('Unset DATABASE_URL to run e2e tests on local postgres');
  }
  const { host, port, username, password } =
    databaseConfig as PostgresConnectionOptions;
  return { type: 'postgres', host, port, username, password, database };
}

// Creates the e2e database when it is missing.
export async function ensureE2eDatabase(): Promise<void> {
  const admin = new DataSource(serverOptions('postgres'));
  await admin.initialize();
  try {
    const rows: unknown[] = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [E2E_DATABASE],
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${E2E_DATABASE}"`);
    }
  } finally {
    await admin.destroy();
  }
}

// The API's entities on the e2e database, rebuilt from scratch on connect.
export function e2eDataSourceOptions(): PostgresConnectionOptions {
  return {
    ...serverOptions(E2E_DATABASE),
    entities: databaseConfig.entities,
    synchronize: true,
    dropSchema: true,
    migrationsRun: false,
  };
}
