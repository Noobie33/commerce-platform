import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  seoInput,
  taxonomyInput,
  taxonomyQuery,
} from '../src/modules/catalog/presentation.validation.js';
import { contentInput } from '../src/modules/catalog/content.validation.js';
const category = () => ({
  id: randomUUID(),
  expectedVersion: 0,
  name: 'Shirts',
  parentId: null,
  active: true,
  slug: 'shirts',
  seo: { title: 'Shirts', description: 'Explore cotton shirts.' },
  reason: 'Prepare navigation',
});
test('taxonomy and search metadata normalize text and retain optional overrides', () => {
  assert.deepEqual(seoInput({ title: '  Cotton shirts  ', description: '' }), {
    title: 'Cotton shirts',
    description: '',
  });
  assert.deepEqual(seoInput({ title: 'Title', description: 'First line\nsecond line' }), {
    title: 'Title',
    description: 'First line second line',
  });
  assert.equal(taxonomyInput({ ...category(), slug: '' }).slug, '');
  assert.equal(taxonomyInput(category()).parentId, null);
});
test('taxonomy and SEO reject unsafe URL names, unknown keys, invalid revisions and control characters', () => {
  for (const body of [
    { ...category(), slug: 'https://other.test' },
    { ...category(), slug: '../shirts' },
    { ...category(), active: 1 },
    { ...category(), expectedVersion: -1 },
    { ...category(), reason: '' },
    { ...category(), parentId: 'bad' },
    { ...category(), extra: true },
  ])
    assert.throws(() => taxonomyInput(body));
  for (const seo of [
    { title: 'x'.repeat(81), description: '' },
    { title: 'ok', description: 'x'.repeat(321) },
    { title: 'Bad\nTitle', description: '' },
    { title: 'Title', description: '', robots: 'index' },
  ])
    assert.throws(() => seoInput(seo));
  assert.throws(() => taxonomyQuery({ status: 'public' }));
  assert.throws(() => taxonomyQuery({ page: '0' }));
});
test('product search overrides belong to draft saves only and legacy requests still validate', () => {
  const b = {
    action: 'save',
    expectedVersion: 0,
    expectedProductVersion: 1,
    profile: 'clothing-v1',
    slug: 'shirt',
    description: 'Cotton shirt',
    specifications: {},
  };
  assert.equal(contentInput(b).seo, undefined);
  assert.deepEqual(contentInput({ ...b, seo: { title: 'Shirt', description: '' } }).seo, {
    title: 'Shirt',
    description: '',
  });
  assert.throws(() =>
    contentInput({
      action: 'approve',
      expectedVersion: 1,
      expectedProductVersion: 1,
      reason: 'Checked',
      seo: { title: 'Changed', description: '' },
    }),
  );
});
