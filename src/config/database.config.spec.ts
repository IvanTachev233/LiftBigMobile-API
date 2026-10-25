import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { databaseConfigFromEnv } from './database.config';

const local = {
  DB_USERNAME: 'local-user',
  DB_PASSWORD: 'local-password',
  DB_NAME: 'local-db',
};
const config = (env: NodeJS.ProcessEnv) =>
  databaseConfigFromEnv(env) as PostgresConnectionOptions;

describe('databaseConfigFromEnv', () => {
  it('uses the DB_* values, with host and port defaulting to the compose database', () => {
    expect(config(local)).toMatchObject({
      host: 'localhost',
      port: 5433,
      username: 'local-user',
      password: 'local-password',
      database: 'local-db',
    });
    expect(
      config({ ...local, DB_HOST: 'postgres', DB_PORT: '5432' }),
    ).toMatchObject({ host: 'postgres', port: 5432 });
  });

  it('stops without a user, password or database name, naming the variable', () => {
    for (const name of ['DB_USERNAME', 'DB_PASSWORD', 'DB_NAME']) {
      expect(() => config({ ...local, [name]: undefined })).toThrow(
        `${name} must be set (or DATABASE_URL); see .env.example`,
      );
      expect(() => config({ ...local, [name]: '' })).toThrow(name);
    }
  });

  it('needs no DB_* values with DATABASE_URL', () => {
    expect(config({ DATABASE_URL: 'postgres://u:p@db/x' })).toMatchObject({
      url: 'postgres://u:p@db/x',
      host: undefined,
      username: undefined,
      password: undefined,
      database: undefined,
    });
  });
});
