import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { enrollmentInput, activationInput } from '../src/modules/identity/onboarding.validation.js';
test('owner enrollment separates credentials from persisted inputs and rejects delegated fields', () => {
  const b = {
    action: 'create',
    id: randomUUID(),
    expectedVersion: 0,
    username: ' Staff.One ',
    displayName: ' Staff One ',
    reason: ' Join team ',
    ownerPassword: 'a test owner password',
  };
  const v = enrollmentInput(b);
  assert.equal(v.input.username, 'staff.one');
  assert.equal(v.input.displayName, 'Staff One');
  assert.equal('ownerPassword' in v.input, false);
  assert.equal(v.ownerPassword, b.ownerPassword);
  for (const x of [
    { ...b, roles: ['owner'] },
    { ...b, password: 'shared password' },
    { ...b, expectedVersion: 1 },
    { ...b, username: 'bad@example.com' },
    { ...b, displayName: 'bad\nname' },
    { ...b, ownerPassword: '' },
    { ...b, reason: '' },
  ])
    assert.throws(() => enrollmentInput(x));
});
test('activation binds a canonical username and opaque code to an untrimmed, NFC-compatible password', () => {
  const pw = '  A long personal passphrase  ';
  assert.deepEqual(
    activationInput({ username: ' STAFF.ONE ', code: 'A'.repeat(43), newPassword: pw }),
    { username: 'staff.one', code: 'A'.repeat(43), newPassword: pw },
  );
  for (const b of [
    { username: 'staff.one', code: 'short', newPassword: pw },
    { username: 'staff.one', code: 'A'.repeat(43), newPassword: 'short' },
    { username: 'staff.one', code: 'A'.repeat(43), newPassword: 'a'.repeat(129) },
    { username: 'staff.one', code: 'A'.repeat(43), newPassword: pw, staffId: randomUUID() },
  ])
    assert.throws(() => activationInput(b));
});
test('reissue and revoke require expected revisions and never accept account identity replacement', () => {
  const b = {
    action: 'reissue',
    id: randomUUID(),
    expectedVersion: 1,
    reason: 'Lost activation code',
    ownerPassword: 'test owner password',
  };
  assert.equal(enrollmentInput(b).input.action, 'reissue');
  for (const x of [
    { ...b, username: 'another' },
    { ...b, expectedVersion: -1 },
    { ...b, action: 'reset_password' },
    { ...b, displayName: 'another' },
  ])
    assert.throws(() => enrollmentInput(x));
});
