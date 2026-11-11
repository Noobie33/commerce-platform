import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoVersion } from '../src/modules/identity/profile-photo.service.js';
import { readAuthConfig } from '../src/modules/identity/auth.config.js';
test('profile photo revisions reject ambiguous or excessive values', () => {
  assert.equal(photoVersion('0'), 0);
  assert.equal(photoVersion('2147483646'), 2147483646);
  for (const v of [undefined, 0, '-1', '01', '1.5', '1e3', '2147483647', ' 1'])
    assert.throws(() => photoVersion(v));
});
test('demo login is isolated from normal staff cookies and requires its dedicated nonproduction database', () => {
  const env = {
    NODE_ENV: 'development',
    DEMO_MODE: '1',
    DATABASE_URL: 'postgresql://demo:unused@127.0.0.1/commerce_platform_demo',
  };
  assert.equal(readAuthConfig(env).cookieName, 'commerce_demo_session');
  assert.equal(readAuthConfig({ NODE_ENV: 'development' }).cookieName, 'commerce_session');
  assert.throws(() =>
    readAuthConfig({
      ...env,
      DATABASE_URL: 'postgresql://dev:unused@127.0.0.1/commerce_platform_dev',
    }),
  );
  assert.throws(() =>
    readAuthConfig({ ...env, NODE_ENV: 'production', STAFF_ORIGIN: 'https://staff.test' }),
  );
});
