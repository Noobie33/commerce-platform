import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogQuery,
  categoryInput,
  decimal,
  priceMinor,
  productInput,
} from '../src/modules/catalog/catalog.validation.js';

const payload = () => ({
  styleCode: 'tee-001',
  name: 'Cotton T-shirt',
  description: '',
  categoryId: null,
  status: 'active',
  currency: 'BDT',
  variants: [
    {
      sku: 'tee-001-m-black',
      attributes: { size: 'M', colour: 'Black' },
      barcode: null,
      price: '1250.10',
      isActive: true,
    },
  ],
});

test('catalog money is exact and rejects unsupported money syntax/ranges', () => {
  for (const [value, minor] of [
    ['0.01', '1'],
    ['1250.10', '125010'],
    ['9999999999.99', '999999999999'],
  ]) {
    assert.equal(priceMinor(value), minor);
    assert.equal(decimal(minor!), value);
  }
  for (const value of ['-1', '1.001', '1e3', '10,000', '10000000000', 'Infinity', 1.2])
    assert.throws(() => priceMinor(value));
});

test('variant identities normalize SKU/canonical option order and reject duplicate combinations', () => {
  const first = payload();
  const second = payload();
  second.variants[0]!.attributes = { colour: 'black', size: 'm' };
  assert.equal(
    productInput(first, false).variants[0]!.optionsKey,
    productInput(second, false).variants[0]!.optionsKey,
  );
  assert.equal(productInput(first, false).variants[0]!.sku, 'TEE-001-M-BLACK');
  const duplicate = payload();
  duplicate.variants.push({ ...duplicate.variants[0]!, sku: 'different-sku' });
  assert.throws(() => productInput(duplicate, false), { status: 400 });
  assert.throws(() => productInput({ ...first, variants: [] }, false));
  assert.throws(() =>
    productInput({ ...first, variants: [{ ...first.variants[0], isActive: false }] }, false),
  );
});

test('catalog requests reject mass assignment, prototype keys, stale/invalid versions and foreign ids', () => {
  assert.throws(() => productInput({ ...payload(), ownerId: 'invented' }, false));
  const polluted = payload();
  polluted.variants[0]!.attributes = JSON.parse('{"__proto__":"bad"}');
  assert.throws(() => productInput(polluted, false));
  assert.throws(() => productInput({ ...payload(), expectedVersion: 0 }, true));
  assert.throws(() => productInput({ ...payload(), categoryId: 'not-a-uuid' }, false));
  assert.equal(productInput({ ...payload(), expectedVersion: 1 }, true).expectedVersion, 1);
});

test('catalog search is bounded and categories allow hierarchical Unicode names', () => {
  const row = categoryInput({ name: 'শিশুদের পোশাক', parentId: null });
  assert.equal(row.name, 'শিশুদের পোশাক');
  assert.throws(() => categoryInput({ name: '', parentId: null }));
  assert.throws(() => catalogQuery({ page: '0' }));
  assert.throws(() => catalogQuery({ pageSize: '1000' }));
  assert.throws(() => catalogQuery({ search: ['not', 'a', 'string'] }));
  assert.deepEqual(catalogQuery({}), {
    search: '',
    status: 'all',
    categoryId: null,
    page: 1,
    pageSize: 20,
  });
});
