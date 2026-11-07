import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseUrl, createDataSource } from '../src/infrastructure/database/data-source.js';

test('database connection fails closed without leaking credentials', () => {
  const secret = 'private-secret';
  for (const value of [
    undefined,
    'invalid',
    'https://localhost/db',
    'postgres://u:' + secret + '@remote.example/db',
    'postgres://u@localhost/db',
  ]) {
    const env: NodeJS.ProcessEnv = {};
    if (value !== undefined) env.DATABASE_URL = value;
    assert.throws(
      () => databaseUrl(env, 'DATABASE_URL'),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  }
});

test('runtime credentials cannot implicitly become migration credentials', () => {
  assert.throws(() =>
    createDataSource({
      DATABASE_URL: 'postgres://runtime:password@localhost/commerce_platform_dev',
    }),
  );
});

test('database factory never connects or synchronizes automatically', () => {
  const source = createDataSource({
    MIGRATION_DATABASE_URL: 'postgres://migrator:password@localhost/commerce_platform_dev',
  });
  assert.equal(source.isInitialized, false);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  assert.equal(source.options.logging, false);
});
