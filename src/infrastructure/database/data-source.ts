import { IdentityFoundation1794096000000 } from '../../database/migrations/1794096000000-identity-foundation.js';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

export function databaseUrl(
  env: NodeJS.ProcessEnv,
  key: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL',
): string {
  const value = env[key];
  if (!value) throw new Error(key + ' is required');
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      !url.pathname ||
      url.pathname === '/'
    )
      throw new Error();
    // Remote TLS policy will be added before remote deployments are enabled.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error();
    return value;
  } catch {
    throw new Error(key + ' must be a local PostgreSQL URL with user, password and database');
  }
}

export function createDataSource(env: NodeJS.ProcessEnv = process.env) {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl(env, 'MIGRATION_DATABASE_URL'),
    synchronize: false,
    migrationsRun: false,
    logging: false,
    entities: [],
    migrations: [IdentityFoundation1794096000000],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'all',
    connectTimeoutMS: 5000,
  });
}

export function createRuntimeDataSource(env: NodeJS.ProcessEnv = process.env) {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl(env, 'DATABASE_URL'),
    synchronize: false,
    migrationsRun: false,
    logging: false,
    entities: [],
    migrations: [],
    connectTimeoutMS: 5000,
    extra: { max: 10, query_timeout: 2000, statement_timeout: 2000 },
  });
}
