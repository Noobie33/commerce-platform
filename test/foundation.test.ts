import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { TestDatabaseDriver } from './support/database-driver.js';

test('configuration rejects invalid ports and deployment modes', () => {
  for (const port of ['0', '-1', '65536', 'abc', '1.5', '']) {
    assert.throws(() => readConfig({ PORT: port }));
  }
  assert.throws(() => readConfig({ NODE_ENV: 'prod' }));
  assert.throws(() => readConfig({ HOST: ' ' }));
  assert.equal(readConfig({}).host, '127.0.0.1');
});

test('real HTTP liveness works and unknown routes return 404', async () => {
  const app = await createApp({}, new TestDatabaseDriver());
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const response = await fetch(`${base}/api/v1/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal((await fetch(`${base}/api/v1/products`)).status, 404);
  } finally {
    await app.close();
  }
});
