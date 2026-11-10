import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { galleryInput } from '../src/modules/catalog/gallery.validation.js';
import { galleryIssues } from '../src/modules/catalog/gallery.service.js';
import type { GalleryAsset } from '../src/modules/catalog/gallery.types.js';
const photo = randomUUID(),
  video = randomUUID(),
  base = {
    action: 'save',
    expectedVersion: 0,
    expectedBasis: 'a'.repeat(64),
    reason: 'Arrange product views',
    items: [
      { kind: 'photo', id: photo },
      { kind: 'video', id: video },
    ],
  };
test('gallery input preserves explicit mixed order and rejects duplicate, unbounded or injected data', () => {
  assert.deepEqual(galleryInput(base).items, base.items);
  for (const value of [
    { ...base, items: [...base.items, base.items[0]] },
    { ...base, items: Array.from({ length: 41 }, () => ({ kind: 'photo', id: randomUUID() })) },
    { ...base, items: [{ kind: 'photo', id: photo, path: '/private' }] },
    { ...base, state: 'published' },
    { ...base, expectedVersion: '0' },
    { ...base, expectedBasis: 'wrong' },
    { ...base, reason: 'x\u0000' },
    { ...base, items: [null] },
  ])
    assert.throws(() => galleryInput(value));
  assert.deepEqual(galleryInput({ ...base, items: [] }).items, []);
});
const asset: GalleryAsset = {
  kind: 'photo',
  id: photo,
  label: 'Cotton shirt front view',
  width: 400,
  height: 480,
  primary: true,
  selectable: true,
  state: 'ready',
  reviewState: 'approved',
  variantId: null,
  variantSku: null,
  hasAudio: false,
  durationSeconds: null,
  url: '/private',
  thumbnailUrl: '/private',
};
test('gallery preparation flags missing primary, review, removed media and audio accessibility', () => {
  assert.deepEqual(galleryIssues([{ kind: 'photo', id: photo }], [asset]), []);
  assert.ok(galleryIssues([], []).length);
  const assets = [
    asset,
    {
      ...asset,
      kind: 'video' as const,
      id: video,
      primary: false,
      hasAudio: true,
      reviewState: 'not_reviewed',
      label: '',
    },
  ];
  const issues = galleryIssues(base.items as { kind: 'photo' | 'video'; id: string }[], assets);
  assert.ok(issues.some((x) => x.includes('captions')));
  assert.ok(issues.some((x) => x.includes('descriptive')));
  assert.ok(issues.some((x) => x.includes('review')));
  assert.ok(
    galleryIssues([{ kind: 'video', id: video }], []).some((x) => x.includes('unavailable')),
  );
  assert.ok(
    galleryIssues([{ kind: 'photo', id: photo }], [{ ...asset, primary: false }]).some((x) =>
      x.includes('first'),
    ),
  );
});
