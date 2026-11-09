import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentInput, contentPage } from '../src/modules/catalog/content.validation.js';
const draft = () => ({
  action: 'save',
  expectedVersion: 0,
  expectedProductVersion: 1,
  profile: 'clothing-v1',
  slug: 'cotton-shirt',
  description: '  Soft cotton\nshirt  ',
  specifications: {
    material: ' Cotton ',
    care: 'Cold wash',
    fit: 'regular',
    garmentLengthCm: '72.50',
  },
});
test('product content normalizes customer copy without coupling it to stock-bearing variant attributes', () => {
  const value = contentInput(draft());
  assert.equal(value.description, 'Soft cotton\nshirt');
  assert.equal(value.specifications!.material, 'Cotton');
  assert.equal(value.specifications!.garmentLengthCm, '72.50');
  assert.equal(value.expectedVersion, 0);
});
test('content requests reject state assignment, profile injection, unsafe copy and invalid revision types', () => {
  for (const patch of [
    { state: 'approved' },
    { expectedVersion: '1' },
    { expectedProductVersion: 0 },
    { slug: '../private' },
    { slug: 'Wrong Case' },
    { description: 'x\u0007' },
    { profile: 'x/other' },
    { specifications: { constructor: 'forged' } },
    { specifications: { material: 1 } },
  ])
    assert.throws(() => contentInput({ ...draft(), ...patch }));
  assert.throws(() => contentInput({ ...draft(), description: 'x'.repeat(2001) }));
});
test('review operations accept only action-specific fields and require a deliberate reason', () => {
  const b = { action: 'submit', expectedVersion: 1, expectedProductVersion: 1 };
  assert.equal(contentInput(b).action, 'submit');
  assert.throws(() => contentInput({ ...b, reason: 'unexpected' }));
  for (const action of ['approve', 'request_changes', 'withdraw']) {
    assert.throws(() => contentInput({ ...b, action }));
    assert.equal(
      contentInput({ ...b, action, reason: ' Checked content ' }).reason,
      'Checked content',
    );
    assert.throws(() => contentInput({ ...b, action, reason: 'Checked', slug: 'overwrite' }));
  }
});
test('content history pagination is strict and bounded', () => {
  assert.equal(contentPage({}), 1);
  assert.equal(contentPage({ page: '2' }), 2);
  for (const page of ['0', '01', '1.5', '1000000', ['1']])
    assert.throws(() => contentPage({ page }));
  assert.throws(() => contentPage({ limit: 100000 }));
});
