import { before } from 'node:test';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { DataSource, type MigrationInterface, type QueryRunner } from 'typeorm';
import { createDataSource, databaseUrl } from '../src/infrastructure/database/data-source.js';

class DatabaseProbe1794000000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      'CREATE TABLE foundation_migration_probe (id integer PRIMARY KEY, label text NOT NULL)',
    );
    await runner.query('GRANT SELECT, INSERT ON foundation_migration_probe TO commerce_test_app');
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE foundation_migration_probe');
  }
}

test('isolated PostgreSQL: compiled migrations, repeat execution, rollback and restricted runtime', async () => {
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL'] as const) {
    assert.equal(
      new URL(databaseUrl(process.env, key)).pathname,
      '/commerce_platform_test',
      'Only the dedicated test database is allowed',
    );
  }
  const base = createDataSource();
  const source = new DataSource({
    ...base.options,
    migrations: [DatabaseProbe1794000000000],
  });
  const runtime = new Client({
    connectionString: databaseUrl(process.env, 'DATABASE_URL'),
    connectionTimeoutMillis: 5000,
  });
  let applied = false;
  try {
    await source.initialize();
    const existing = await source.query(
      "SELECT to_regclass('public.foundation_migration_probe') AS name",
    );
    assert.equal(existing[0].name, null, 'Probe left from earlier run: inspect before retrying');
    assert.equal((await source.runMigrations()).length, 1);
    applied = true;
    assert.equal((await source.runMigrations()).length, 0);
    await runtime.connect();
    await runtime.query('INSERT INTO foundation_migration_probe VALUES ($1, $2)', [1, 'verified']);
    assert.equal(
      (await runtime.query('SELECT label FROM foundation_migration_probe WHERE id = $1', [1]))
        .rows[0].label,
      'verified',
    );
    await assert.rejects(runtime.query('CREATE TABLE forbidden_probe (id integer)'), {
      code: '42501',
    });
    await assert.rejects(runtime.query('SELECT * FROM schema_migrations'), { code: '42501' });
    await source.undoLastMigration();
    applied = false;
    assert.equal(
      (await source.query("SELECT to_regclass('public.foundation_migration_probe') AS name"))[0]
        .name,
      null,
    );
    await assert.rejects(
      source.transaction(async (manager) => {
        await manager.query('CREATE TABLE rollback_probe (id integer)');
        throw new Error('Intentional rollback');
      }),
      /Intentional rollback/,
    );
    assert.equal(
      (await source.query("SELECT to_regclass('public.rollback_probe') AS name"))[0].name,
      null,
    );
  } finally {
    await runtime.end().catch(() => undefined);
    if (applied) await source.undoLastMigration();
    if (source.isInitialized) await source.destroy();
  }
});

import { createApp } from '../src/app.js';
import { createRuntimeDataSource } from '../src/infrastructure/database/data-source.js';

test('real PostgreSQL runtime pool powers readiness and closes with the API', async () => {
  assert.equal(
    new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const source = createRuntimeDataSource();
  const app = await createApp(process.env, source);
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    assert.equal((await fetch(base + '/api/v1/health/ready')).status, 200);
    assert.equal((await source.query('SELECT current_user AS name'))[0].name, 'commerce_test_app');
    await source.destroy();
    const unavailable = await fetch(base + '/api/v1/health/ready');
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
    assert.equal((await fetch(base + '/api/v1/health/live')).status, 200);
    await source.initialize();
    assert.equal((await fetch(base + '/api/v1/health/ready')).status, 200);
  } finally {
    await app.close();
  }
  assert.equal(source.isInitialized, false);
});

before(async () => {
  const source = createDataSource();
  if (
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname !==
    '/commerce_platform_test'
  )
    throw new Error('Dedicated test database only');
  try {
    await source.initialize();
    await source.runMigrations();
    await grantRuntime(source, process.env);
  } finally {
    if (source.isInitialized) await source.destroy();
  }
});
