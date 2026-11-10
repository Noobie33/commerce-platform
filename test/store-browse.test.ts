import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeBrowseQuery } from '../src/modules/catalog/store-browse.validation.js';
test('store browse normalizes human filters without floating-point money', () => {
  const q = storeBrowseQuery({
    q: '  COTTON   Shirt ',
    size: '\uff2d ',
    color: ' RED ',
    minPriceMinor: '0',
    maxPriceMinor: '999999999999',
    page: '1000',
    pageSize: '48',
    sort: 'price_desc',
  });
  assert.equal(q.q, 'cotton shirt');
  assert.equal(q.size, 'm');
  assert.equal(q.color, 'red');
  assert.equal(q.minPriceMinor, '0');
  assert.equal(q.maxPriceMinor, '999999999999');
  assert.equal(q.page, 1000);
  assert.equal(storeBrowseQuery({}).pageSize, 24);
});
test('store browse rejects unbounded, ambiguous and staff-only queries', () => {
  for (const q of [
    null,
    [],
    { q: ['one', 'two'] },
    { page: '1001' },
    { page: '0' },
    { page: '01' },
    { pageSize: '500' },
    { sort: 'name; DROP TABLE catalog_releases' },
    { brand: 'other' },
    { includeDrafts: 'true' },
    { q: '' },
    { q: 'x'.repeat(81) },
    { size: 'x'.repeat(61) },
    { category: '../private' },
    { fit: 'anything' },
    { q: 'bad\nquery' },
    { color: { red: 'yes' } },
    { q: 'x', color: 'y'.repeat(1400) },
  ])
    assert.throws(() => storeBrowseQuery(q));
});
test('store browse accepts exact minor-unit ranges and rejects misleading prices', () => {
  for (const q of [
    { minPriceMinor: '1.5' },
    { minPriceMinor: 1 },
    { minPriceMinor: '-1' },
    { minPriceMinor: '01' },
    { maxPriceMinor: '1000000000000' },
    { minPriceMinor: '200', maxPriceMinor: '100' },
    { minPriceMinor: '1e4' },
  ])
    assert.throws(() => storeBrowseQuery(q));
  assert.equal(
    storeBrowseQuery({
      category: 'mens-shirts',
      fit: 'regular',
      minPriceMinor: '100',
      maxPriceMinor: '100',
    }).category,
    'mens-shirts',
  );
});
