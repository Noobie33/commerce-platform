import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationInput } from '../src/modules/catalog/publication.validation.js';
test('publication actions require bounded revisions, reasons and explicit photo alternative text', () => {
  assert.deepEqual(
    publicationInput(
      { action: 'approve', expectedVersion: 0, reason: ' Review ', alt: ' Cotton shirt ' },
      true,
    ),
    { action: 'approve', expectedVersion: 0, reason: 'Review', alt: 'Cotton shirt' },
  );
  for (const b of [
    { action: 'approve', expectedVersion: 0, reason: 'ok', alt: '' },
    { action: 'approve', expectedVersion: 0, reason: 'ok', alt: 'bad\nalt' },
    { action: 'revoke', expectedVersion: -1, reason: 'ok' },
    { action: 'revoke', expectedVersion: 1, reason: '' },
    { action: 'revoke', expectedVersion: 1, reason: 'ok', imageHash: 'fake' },
  ])
    assert.throws(() => publicationInput(b, true));
});
test('publishing requires reviewed product revisions while withdrawal never accepts client snapshots', () => {
  const b = {
    action: 'publish',
    expectedVersion: 0,
    expectedContentVersion: 3,
    expectedProductVersion: 2,
    reason: 'Launch reviewed product',
  };
  assert.equal(publicationInput(b, false).action, 'publish');
  for (const x of [
    { ...b, expectedContentVersion: undefined },
    { ...b, expectedProductVersion: 0 },
    { ...b, snapshot: {} },
    { action: 'unpublish', expectedVersion: 1, reason: 'Withdraw', alt: 'hidden' },
    { ...b, action: 'approve' },
  ])
    assert.throws(() => publicationInput(x, false));
  assert.equal(
    publicationInput({ action: 'unpublish', expectedVersion: 1, reason: 'Withdraw' }, false).action,
    'unpublish',
  );
});
