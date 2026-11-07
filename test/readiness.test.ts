import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { TestDatabaseDriver } from './support/database-driver.js';

test('readiness follows DB failure/recovery while liveness stays available; close releases pool', async () => {
  const driver = new TestDatabaseDriver();
  const app = await createApp({}, driver);
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    assert.equal((await fetch(base + '/api/v1/health/ready')).status, 200);
    driver.available = false;
    const response = await fetch(base + '/api/v1/health/ready');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable' });
    assert.equal((await fetch(base + '/api/v1/health/live')).status, 200);
    driver.available = true;
    assert.equal((await fetch(base + '/api/v1/health/ready')).status, 200);
  } finally {
    await app.close();
  }
  assert.equal(driver.closeCount, 1);
});

test('startup refuses unavailable database and sanitizes its error', async () => {
  const driver = new TestDatabaseDriver();
  driver.startupFailure = true;
  const app = await createApp({}, driver);
  try {
    await assert.rejects(app.listen(0, '127.0.0.1'), { message: 'Database initialization failed' });
  } finally {
    await app.close();
  }
});

test('readiness fails before initialization and during shutdown', async () => {
  const driver = new TestDatabaseDriver();
  const service = new DatabaseService(driver);
  assert.equal(await service.isReady(), false);
  await service.onApplicationBootstrap();
  service.beforeApplicationShutdown();
  assert.equal(await service.isReady(), false);
  await service.onApplicationShutdown();
});

test('pending application schema fails startup and cleans up the initialized pool', async () => {
  class PendingSchema extends TestDatabaseDriver {
    override async query(_sql: string) {
      return [{ version: 0 }];
    }
  }
  const driver = new PendingSchema();
  const app = await createApp({}, driver);
  try {
    await assert.rejects(app.listen(0, '127.0.0.1'), { message: 'Database initialization failed' });
  } finally {
    await app.close();
  }
  assert.equal(driver.closeCount, 1);
});
