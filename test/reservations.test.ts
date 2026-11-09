import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reservationInput, reservationPage } from '../src/modules/sales/reservation.validation.js';
import { receiptError } from '../src/modules/purchasing/receipt.errors.js';
test('stock hold requests bound duration, revision and action-specific fields', () => {
  const b = {
    expectedVersion: 1,
    expectedRevision: 1,
    holdMinutes: 30,
    reason: ' Hold for customer review ',
  };
  assert.equal(reservationInput(b).reason, 'Hold for customer review');
  for (const holdMinutes of [14, 1441, 30.5, '30'])
    assert.throws(() => reservationInput({ ...b, holdMinutes }));
  assert.throws(() => reservationInput({ ...b, reservationId: randomUUID() }));
  assert.throws(() => reservationInput({ ...b, reason: ' ' }));
  assert.throws(() => reservationInput({ ...b, expectedRevision: 0 }));
  assert.throws(() => reservationPage({ page: ['1'] }));
  assert.equal(reservationPage({ page: '2' }), 2);
  assert.equal(
    reservationInput(
      { expectedVersion: 2, expectedRevision: 2, reservationId: randomUUID(), reason: 'Release' },
      true,
    ).expectedRevision,
    2,
  );
});
test('purchase receipt reversals surface held-stock conflicts without exposing database details', () => {
  assert.throws(
    () => receiptError({ driverError: { message: 'INVENTORY_RESERVED' } }),
    (e: unknown) =>
      Boolean(
        e &&
        typeof e === 'object' &&
        'getStatus' in e &&
        typeof e.getStatus === 'function' &&
        e.getStatus() === 409 &&
        'getResponse' in e &&
        typeof e.getResponse === 'function' &&
        e.getResponse().code === 'STOCK_RESERVED',
      ),
  );
});
