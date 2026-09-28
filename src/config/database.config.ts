import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  host: process.env.DATABASE_URL
    ? undefined
    : process.env.DB_HOST || 'localhost',
  port: process.env.DATABASE_URL
    ? undefined
    : parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DATABASE_URL
    ? undefined
    : process.env.DB_USERNAME || 'liftbig',
  password: process.env.DATABASE_URL
    ? undefined
    : process.env.DB_PASSWORD || 'password123',
  database: process.env.DATABASE_URL
    ? undefined
    : process.env.DB_NAME || 'liftbig_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  migrationsRun: process.env.RUN_MIGRATIONS === 'true',
  synchronize:
    process.env.TYPEORM_SYNC === 'true' ||
    process.env.NODE_ENV !== 'production',
  retryAttempts: 3,
  retryDelay: 3000,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
};
