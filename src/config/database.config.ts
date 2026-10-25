import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

// This file is read before @nestjs/config loads .env, so it loads .env itself;
// variables already in the environment win
if (existsSync('.env')) loadEnvFile();

/**
 * Connection settings from DATABASE_URL, or else from DB_HOST/DB_PORT
 * (default: the compose database on localhost:5433) and DB_USERNAME,
 * DB_PASSWORD and DB_NAME, which have no default: a missing one throws.
 */
export function databaseConfigFromEnv(
  env: NodeJS.ProcessEnv,
): TypeOrmModuleOptions {
  const url = env.DATABASE_URL;
  return {
    type: 'postgres',
    url,
    host: url ? undefined : env.DB_HOST || 'localhost',
    port: url ? undefined : parseInt(env.DB_PORT || '5433', 10),
    username: url ? undefined : required(env, 'DB_USERNAME'),
    password: url ? undefined : required(env, 'DB_PASSWORD'),
    database: url ? undefined : required(env, 'DB_NAME'),
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../migrations/*{.ts,.js}'],
    migrationsRun: env.RUN_MIGRATIONS === 'true',
    synchronize: env.TYPEORM_SYNC === 'true' || env.NODE_ENV !== 'production',
    retryAttempts: 3,
    retryDelay: 3000,
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} must be set (or DATABASE_URL); see .env.example`);
  }
  return value;
}

export const databaseConfig = databaseConfigFromEnv(process.env);
