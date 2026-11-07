import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { permits } from '../src/modules/authorization/policy.js';
import { readAuthConfig } from '../src/modules/identity/auth.config.js';

test('native scrypt salts passwords, verifies safely and rejects unknown profiles', async () => {
  const service = new PasswordService();
  const first = await service.hash('A long staff password 123!');
  const second = await service.hash('A long staff password 123!');
  assert.notEqual(first, second);
  assert.equal(first.includes('A long staff password'), false);
  assert.equal(await service.verify('A long staff password 123!', first), true);
  assert.equal(await service.verify('wrong password', first), false);
  assert.equal(await service.verify('anything', 'scrypt$999999999$8$3$bad$bad'), false);
  assert.equal(await service.verify('anything'), false);
  await assert.rejects(service.hash('short'), /15 to 128/);
  await assert.rejects(service.hash('x'.repeat(129)), /15 to 128/);
});

test('location grants never authorize global operations or another location', () => {
  const local = [{ code: 'staff.read', locationId: 'location-a' }];
  assert.equal(permits(local, 'staff.read'), false);
  assert.equal(permits(local, 'staff.read', 'location-b'), false);
  assert.equal(permits(local, 'staff.read', 'location-a'), true);
  assert.equal(
    permits([{ code: 'staff.read', locationId: null }], 'staff.read', 'location-b'),
    true,
  );
  assert.equal(permits(local, 'roles.manage', 'location-a'), false);
});

test('production cookie policy requires HTTPS and one exact origin', () => {
  assert.throws(() => readAuthConfig({ NODE_ENV: 'production' }), /HTTPS/);
  for (const origin of [
    '*',
    'https://staff.example/path',
    'https://staff.example/',
    'https://user:secret@staff.example',
  ]) {
    assert.throws(() => readAuthConfig({ STAFF_ORIGIN: origin }));
  }
  const config = readAuthConfig({ NODE_ENV: 'production', STAFF_ORIGIN: 'https://staff.example' });
  assert.equal(config.secure, true);
  assert.ok(config.cookieName.startsWith('__Host-'));
});

import { createApp } from '../src/app.js';
import { TestDatabaseDriver } from './support/database-driver.js';

test('expensive password work has a bounded concurrency limit', async () => {
  const service = new PasswordService();
  const first = service.hash('First long staff password 123!');
  const second = service.hash('Second long staff password 123!');
  await assert.rejects(service.hash('Third long staff password 123!'), { status: 503 });
  await Promise.all([first, second]);
});

test('malformed/oversized JSON is rejected without echoing credentials', async () => {
  const app = await createApp({}, new TestDatabaseDriver());
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const headers = {
      Origin: 'http://127.0.0.1:4000',
      'Content-Type': 'application/json',
      'X-Requested-With': 'commerce-staff',
    };
    const secret = 'must-not-appear-in-response';
    const malformed = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers,
      body: '{"password":"' + secret + '"',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.text()).includes(secret), false);
    assert.equal(malformed.headers.get('cache-control'), 'no-store');
    const large = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'x'.repeat(17000) }),
    });
    assert.equal(large.status, 413);
  } finally {
    await app.close();
  }
});
