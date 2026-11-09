import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phone,
  creditInput,
  customerInput,
  listQuery,
} from '../src/modules/customers/customer.validation.js';
test('customer contact normalization preserves identity and supports local and international formats', () => {
  assert.equal(phone('০১৭০০ ০০০০০০'), '+8801700000000');
  assert.equal(phone('8801700000000'), '+8801700000000');
  assert.equal(phone('+44 (20) 7946-0123'), '+442079460123');
  assert.equal(phone(''), '');
  assert.throws(() => phone('01700'));
  assert.throws(() => phone('++8801700000000'));
  assert.throws(() => listQuery({ status: ['active'] }));
});
test('customer policy uses exact minor units and strict disabled-state and version validation', () => {
  const b = {
    expectedVersion: 1,
    creditEnabled: true,
    creditLimit: '999999999999.99',
    paymentTermsDays: 365,
    reason: 'Policy',
  };
  assert.equal(creditInput(b).creditLimit, '99999999999999');
  assert.throws(() => creditInput({ ...b, creditLimit: '1000000000000' }));
  assert.throws(() => creditInput({ ...b, creditLimit: '1e3' }));
  assert.throws(() => creditInput({ ...b, creditLimit: '1.001' }));
  assert.throws(() => creditInput({ ...b, creditEnabled: false }));
  assert.throws(() => creditInput({ ...b, expectedVersion: '1' }));
  assert.throws(() => creditInput({ ...b, reason: ' ' }));
  assert.equal(
    creditInput({ ...b, creditEnabled: false, creditLimit: '0', paymentTermsDays: 0 }).creditLimit,
    '0',
  );
  const person = { customerKind: 'person', segment: 'retail', name: ' Walk-in ', isActive: true };
  assert.equal(customerInput(person).name, 'Walk-in');
  assert.equal(customerInput(person).phone, '');
  assert.throws(() => customerInput({ ...person, creditLimit: '100' }));
});
