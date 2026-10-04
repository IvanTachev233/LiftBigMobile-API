import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { databaseConfig } from './database.config';

// Data source for the TypeORM CLI (migration:run / migration:revert). Uses
// the API's connection settings, but never syncs or runs migrations on
// connect; the CLI command decides what runs.
export default new DataSource({
  ...(databaseConfig as PostgresConnectionOptions),
  synchronize: false,
  migrationsRun: false,
});
