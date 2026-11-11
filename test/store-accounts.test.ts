import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountLogin, customerToken } from '../src/modules/store-accounts/account.validation.js';
import { accountMode } from '../src/modules/store-accounts/account.config.js';
import {
  accountSession,
  accountView,
  customerCookieName,
} from '../apps/storefront/src/lib/account-contract.js';
test('customer login accepts bounded normalized email credentials and rejects extra identities', () => {
  assert.deepEqual(
    accountLogin({
      email: ' Demo.Customer@Example.Invalid ',
      password: 'a long customer password',
    }),
    { email: 'demo.customer@example.invalid', password: 'a long customer password' },
  );
  for (const v of [
    { email: 'bad', password: 'p' },
    { email: 'a@b.test', password: 'p', staffId: 'private' },
    { email: 'a@b.test', password: '' },
    { email: 'a@b.test', password: 'x'.repeat(129) },
    [],
    null,
  ])
    assert.throws(() => accountLogin(v));
  assert.equal(customerToken('x'.repeat(43)), 'x'.repeat(43));
  for (const v of ['short', undefined, ['x'.repeat(43)]]) assert.equal(customerToken(v), null);
});
test('customer identity preview is closed by default and cannot run on production or another database', () => {
  assert.equal(accountMode({}), 'closed');
  assert.equal(
    accountMode({
      CUSTOMER_ACCOUNT_MODE: 'preview',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://demo:unused@127.0.0.1/commerce_platform_test',
    }),
    'preview',
  );
  for (const env of [
    { CUSTOMER_ACCOUNT_MODE: 'open' },
    { CUSTOMER_ACCOUNT_MODE: 'preview', NODE_ENV: 'production' },
    { CUSTOMER_ACCOUNT_MODE: 'preview', DATABASE_URL: 'postgresql://demo:unused@127.0.0.1/other' },
  ])
    assert.throws(() => accountMode(env));
});
test('customer public view strips private additions and local cookies isolate storefront ports', () => {
  const v = {
    account: {
      displayName: 'Demo',
      email: 'demo@example.invalid',
      password: 'private',
      grants: ['private'],
    },
    expiresAt: '2030-01-01T12:00:00.000Z',
    csrfToken: 'a'.repeat(64),
    token: 'private',
  };
  const parsed = accountSession(v);
  assert.ok(!JSON.stringify(parsed).includes('private'));
  assert.deepEqual(accountView({ ...v, state: 'signed-in' }), {
    state: 'signed-in',
    account: { displayName: 'Demo', email: 'demo@example.invalid' },
    expiresAt: v.expiresAt,
  });
  assert.notEqual(
    customerCookieName('http://127.0.0.1:3000'),
    customerCookieName('http://127.0.0.1:3100'),
  );
  assert.equal(
    customerCookieName('https://shop.example.invalid'),
    '__Host-commerce_customer_session',
  );
  assert.throws(() => accountSession({ ...v, csrfToken: 'bad' }));
  assert.throws(() => accountView({ state: 'signed-in', account: {} }));
});
