import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryReviewInput } from '../src/modules/catalog/gallery-release.validation.js';
test('gallery consent cannot accept client attestations or missing rights', () => {
  const b = {
    action: 'approve',
    expectedVersion: 0,
    reason: 'Our product media',
    expectedDraftVersion: 1,
    expectedBasis: 'a'.repeat(64),
    rightsConfirmed: true,
  };
  assert.equal(galleryReviewInput(b).rightsConfirmed, true);
  for (const v of [
    { ...b, rightsConfirmed: false },
    { ...b, verifiedBasis: 'a'.repeat(64) },
    { ...b, expectedDraftVersion: 0 },
    { ...b, expectedBasis: 'wrong' },
    { ...b, expectedVersion: '0' },
    { ...b, reason: ' ' },
    { ...b, action: 'publish' },
  ])
    assert.throws(() => galleryReviewInput(v));
  assert.equal(
    galleryReviewInput({ action: 'revoke', expectedVersion: 1, reason: 'Withdraw' }).action,
    'revoke',
  );
});
