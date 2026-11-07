import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { TestDatabaseDriver } from './support/database-driver.js';

test('public admin document/assets load while data APIs remain protected; no private files served', async () => {
  const app = await createApp({}, new TestDatabaseDriver());
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const response = await fetch(base + '/admin');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/html/);
    assert.ok(response.headers.get('content-security-policy')?.includes("script-src 'self'"));
    const html = await response.text();
    assert.ok(html.includes('Commerce — Staff workspace'));
    const asset = html.match(/src="(\/admin\/assets\/[^"]+\.js)"/)?.[1];
    assert.ok(asset, 'A built, hashed JavaScript asset must be present');
    const javascript = await fetch(base + asset);
    assert.equal(javascript.status, 200);
    const code = await javascript.text();
    for (const key of ['MIGRATION_DATABASE_URL=', 'PGPASSWORD=', 'owner-access.json'])
      assert.equal(code.includes(key), false);
    assert.equal((await fetch(base + '/api/v1/staff/me')).status, 401);
    assert.equal((await fetch(base + '/admin/assets/.env')).status >= 400, true);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/.local-setup/owner-access.json')).status, 404);
  } finally {
    await app.close();
  }
});
