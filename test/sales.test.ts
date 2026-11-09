import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { salesInput, minor, decimal, listQuery } from '../src/modules/sales/sales.validation.js';
const body = () => ({
  customerId: randomUUID(),
  customerVersion: 1,
  locationId: randomUUID(),
  channel: 'retail',
  fulfillOn: '2028-02-29',
  lines: [{ variantId: randomUUID(), quantity: '3', unitPrice: '0.10', priceMode: 'catalog' }],
});
test('sales draft money and dates remain exact, bounded and canonical', () => {
  assert.equal(minor('9999999999.99'), '999999999999');
  assert.equal(decimal('1'), '0.01');
  const input = salesInput(body());
  assert.equal(input.lines[0]!.unitPrice, '10');
  assert.equal(input.fulfillOn, '2028-02-29');
  for (const price of ['01.00', '-1', '1e3', '1.001', '10000000000.00'])
    assert.throws(() => minor(price));
  assert.throws(() => salesInput({ ...body(), fulfillOn: '2027-02-29' }));
  assert.throws(() => salesInput({ ...body(), fulfillOn: '2026-04-31' }));
});
test('sales drafts strictly validate identifiers, quantities, overrides, mass assignment and query limits', () => {
  const b = body();
  assert.throws(() => salesInput({ ...b, lines: [...b.lines, ...b.lines] }));
  assert.throws(() => salesInput({ ...b, lines: [{ ...b.lines[0], quantity: '0' }] }));
  assert.throws(() => salesInput({ ...b, lines: [{ ...b.lines[0], priceMode: 'override' }] }));
  assert.throws(() => salesInput({ ...b, status: 'confirmed' }));
  assert.throws(() => salesInput({ ...b, customerVersion: '1' }));
  assert.throws(() =>
    salesInput({
      ...b,
      lines: Array.from({ length: 31 }, () => ({ ...b.lines[0], variantId: randomUUID() })),
    }),
  );
  assert.throws(() => listQuery({ page: ['1'] }));
  assert.throws(() => listQuery({ status: 'confirmed' }));
  assert.throws(() => listQuery({ country: 'BD' }));
  assert.throws(() => salesInput({ ...b, channel: 'wholesale' }));
  assert.throws(() =>
    salesInput({
      ...b,
      priceReason: 'Agreed trade price',
      lines: [{ ...b.lines[0], priceMode: 'override' }],
    }),
  );
  assert.throws(() => salesInput({ ...b, priceReason: 'Unapproved discount' }));
  assert.equal(salesInput({ ...b, channel: undefined }).channel, 'retail');
});
