import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, customerInput, listQuery } from '../src/modules/customers/customer.validation.js';
test('customer contact normalization preserves identity and supports local and international formats', () => {
  assert.equal(phone('০১৭০০ ০০০০০০'), '+8801700000000');
  assert.equal(phone('8801700000000'), '+8801700000000');
  assert.equal(phone('+44 (20) 7946-0123'), '+442079460123');
  assert.equal(phone(''), '');
  assert.throws(() => phone('01700'));
  assert.throws(() => phone('++8801700000000'));
  assert.throws(() => listQuery({ status: ['active'] }));
});
test('retail profiles reject trade segments, credit mass assignment and invalid revisions', () => {
  const person = { customerKind: 'person', segment: 'retail', name: ' Walk-in ', isActive: true };
  assert.equal(customerInput(person).name, 'Walk-in');
  assert.equal(customerInput({ ...person, segment: undefined }).segment, 'retail');
  assert.equal(customerInput(person).phone, '');
  for (const segment of ['wholesale', 'both', null])
    assert.throws(() => customerInput({ ...person, segment }));
  for (const field of ['creditEnabled', 'creditLimit', 'paymentTermsDays'])
    assert.throws(() => customerInput({ ...person, [field]: '100' }));
  assert.throws(() => customerInput({ ...person, expectedVersion: '1' }, true));
});
