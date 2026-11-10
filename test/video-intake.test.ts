import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  videoAction,
  videoRange,
  videoVersion,
  videoPage,
} from '../src/modules/catalog/video.validation.js';
import { localVideoEnabled } from '../src/infrastructure/media/video-intake.store.js';
test('video actions reject state/lease assignment and require revisions, reasons and explicit rights', () => {
  assert.equal(videoVersion('1'), 1);
  for (const v of ['0', '-1', '01', '2147483647', 1]) assert.throws(() => videoVersion(v));
  const base = {
    action: 'metadata',
    expectedVersion: 1,
    reason: ' Verify ',
    description: ' Cotton shirt ',
    variantId: null,
    position: 0,
  };
  assert.equal(videoAction(base).description, 'Cotton shirt');
  for (const b of [
    { ...base, lease_token: 'fake' },
    { ...base, state: 'ready' },
    { ...base, position: -1 },
    { ...base, expectedVersion: 0 },
    { ...base, reason: '' },
    { action: 'approve', expectedVersion: 1, reason: 'ok', rightsConfirmed: false },
  ])
    assert.throws(() => videoAction(b));
  assert.equal(
    videoAction({
      action: 'approve',
      expectedVersion: 1,
      reason: 'Verified',
      rightsConfirmed: true,
    }).rightsConfirmed,
    true,
  );
  assert.throws(() => videoPage({ removed: 'true' }));
});
test('private playback range parsing handles inclusive, suffix and invalid ranges', () => {
  assert.deepEqual(videoRange('bytes=0-9', 100), { start: 0, end: 9, status: 206 });
  assert.deepEqual(videoRange('bytes=-10', 100), { start: 90, end: 99, status: 206 });
  assert.deepEqual(videoRange('bytes=90-', 100), { start: 90, end: 99, status: 206 });
  for (const v of ['bytes=-0', 'bytes=100-', 'bytes=8-2', 'bytes=0-1,3-4', 'bytes=-', 'garbage'])
    assert.equal(videoRange(v, 100), null);
  assert.equal(videoRange(undefined, 100)!.status, 200);
});
test('video intake is explicitly local-only and cannot be enabled by a production flag', () => {
  assert.equal(
    localVideoEnabled({
      NODE_ENV: 'development',
      VIDEO_INTAKE_MODE: 'local-development',
      HOST: '127.0.0.1',
    }),
    true,
  );
  for (const env of [
    { NODE_ENV: 'production', VIDEO_INTAKE_MODE: 'local-development' },
    { HOST: '0.0.0.0', VIDEO_INTAKE_MODE: 'local-development' },
    {},
  ])
    assert.equal(localVideoEnabled(env), false);
});
