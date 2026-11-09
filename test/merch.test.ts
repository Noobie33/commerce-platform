import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  merchInput,
  merchAssignments,
  merchQuery,
} from '../src/modules/catalog/merch.validation.js';
import { contentInput } from '../src/modules/catalog/content.validation.js';
const guide = () => ({
  id: randomUUID(),
  kind: 'size_guide',
  slug: 'shirts-garment-cm',
  expectedVersion: 0,
  reason: 'Initial verified chart',
  definition: {
    title: 'Shirt chart',
    active: true,
    unit: 'cm',
    basis: 'garment',
    instructions: 'Measure flat.\nDo not stretch.',
    columns: ['Chest', 'Length'],
    rows: [{ size: 'M', values: ['98.50', '72.00'] }],
  },
});
test('size guides preserve exact decimal text and explicit measurement convention', () => {
  const b = guide();
  const x = merchInput(b);
  assert.deepEqual(x.definition, b.definition);
  assert.equal(x.expectedVersion, 0);
});
test('guides reject incomplete, duplicate, unsafe and ambiguous measurement grids', () => {
  for (const d of [
    { ...guide().definition, unit: 'mm' },
    { ...guide().definition, basis: 'unknown' },
    { ...guide().definition, columns: ['Chest', 'chest'] },
    { ...guide().definition, rows: [{ size: 'M', values: ['0', '72'] }] },
    { ...guide().definition, rows: [{ size: 'M', values: ['1e2', '72'] }] },
    { ...guide().definition, rows: [{ size: 'M', values: ['98'] }] },
    {
      ...guide().definition,
      rows: [
        { size: 'M', values: ['98', '72'] },
        { size: 'm', values: ['99', '73'] },
      ],
    },
    { ...guide().definition, title: 'Bad\nlabel' },
  ])
    assert.throws(() => merchInput({ ...guide(), definition: d }));
  assert.throws(() => merchInput({ ...guide(), extra: true }));
  assert.throws(() => merchInput({ ...guide(), expectedVersion: 0.5 }));
  assert.throws(() => merchInput({ ...guide(), slug: 'Mutable / URL' }));
});
test('collection definitions and version references are strict, canonical and bounded', () => {
  const c = merchInput({
    id: randomUUID(),
    kind: 'collection',
    slug: 'new-arrivals',
    expectedVersion: 0,
    reason: 'Launch grouping',
    definition: { title: 'New arrivals', active: true, description: 'Seasonal edit' },
  });
  assert.equal(c.kind, 'collection');
  const a = randomUUID(),
    b = randomUUID();
  assert.deepEqual(
    merchAssignments({
      sizeGuide: null,
      collections: [
        { id: b, version: 2 },
        { id: a, version: 1 },
      ],
    }).collections.map((x) => x.id),
    [a, b].sort(),
  );
  assert.throws(() =>
    merchAssignments({
      sizeGuide: null,
      collections: [
        { id: a, version: 1 },
        { id: a, version: 2 },
      ],
    }),
  );
  assert.throws(() => merchAssignments({ sizeGuide: { id: a, version: 0 }, collections: [] }));
  assert.throws(() => merchAssignments({ sizeGuide: null, collections: [], extra: true }));
  assert.throws(() => merchQuery({ kind: 'brand' }));
});
test('only content draft saves accept merchandising assignments; old clients remain valid', () => {
  const body = {
    action: 'save',
    expectedVersion: 0,
    expectedProductVersion: 1,
    profile: 'clothing-v1',
    slug: 'shirt',
    description: 'Shirt',
    specifications: {},
  };
  assert.equal(contentInput(body).merchandising, undefined);
  assert.deepEqual(
    contentInput({ ...body, merchandising: { sizeGuide: null, collections: [] } }).merchandising,
    { sizeGuide: null, collections: [] },
  );
  assert.throws(() =>
    contentInput({
      action: 'submit',
      expectedVersion: 1,
      expectedProductVersion: 1,
      merchandising: { sizeGuide: null, collections: [] },
    }),
  );
});
