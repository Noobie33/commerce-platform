import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readVideoPolicy, readVideoTools } from '../src/infrastructure/media/video-policy.js';
import { parseVideoMetadata } from '../src/infrastructure/media/video-metadata.js';
import { runMediaProcess } from '../src/infrastructure/media/bounded-media-process.js';
const metadata = () => ({
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', size: '100', duration: '1.200000' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 320,
      height: 240,
      avg_frame_rate: '24/1',
      r_frame_rate: '24/1',
      pix_fmt: 'yuv420p',
      sample_aspect_ratio: '1:1',
      duration: '1.200000',
      disposition: { attached_pic: 0 },
    },
  ],
});
test('video policy validates operational limits and explicit absolute private tool paths', () => {
  assert.equal(readVideoPolicy().maxDurationSeconds, 120);
  assert.equal(readVideoPolicy({ VIDEO_MAX_UPLOAD_MB: '200' }).maxSourceBytes, 200 * 1024 * 1024);
  for (const env of [
    { VIDEO_MAX_UPLOAD_MB: '201' },
    { VIDEO_MAX_UPLOAD_MB: '1.5' },
    { VIDEO_MAX_DURATION_SECONDS: '0' },
    { VIDEO_MAX_DURATION_SECONDS: '301' },
  ])
    assert.throws(() => readVideoPolicy(env));
  assert.throws(() => readVideoTools({}));
  assert.throws(() => readVideoTools({ FFMPEG_PATH: 'ffmpeg' }));
  const root = resolve('video-private-test');
  assert.equal(
    readVideoTools({
      FFMPEG_PATH: resolve('ffmpeg'),
      FFPROBE_PATH: resolve('ffprobe'),
      VIDEO_WORK_DIR: root,
      VIDEO_ARTIFACT_DIR: root,
    }).workRoot,
    root,
  );
});
test('video metadata handles exact streams, duration and orthogonal display rotation', () => {
  const m = metadata();
  const normal = parseVideoMetadata(m, readVideoPolicy(), 100);
  assert.equal(normal.fps, 24);
  assert.equal(normal.hasAudio, false);
  const portrait = { ...m, streams: [{ ...m.streams[0], side_data_list: [{ rotation: -90 }] }] };
  const v = parseVideoMetadata(portrait, readVideoPolicy(), 100);
  assert.equal(v.displayWidth, 240);
  assert.equal(v.displayHeight, 320);
  assert.equal(v.rotation, 270);
});
test('video metadata rejects hostile, ambiguous, HDR and resource-heavy inputs', () => {
  const m = metadata();
  for (const value of [
    null,
    {},
    { ...m, format: { ...m.format, size: '101' } },
    { ...m, format: { ...m.format, format_name: 'hls' } },
    { ...m, format: { ...m.format, duration: 'NaN' } },
    { ...m, format: { ...m.format, duration: '121' } },
    { ...m, streams: [...m.streams, ...m.streams] },
    ...[
      { width: 9000 },
      { width: -2 },
      { height: 0 },
      { avg_frame_rate: '121/1' },
      { avg_frame_rate: '0/0', r_frame_rate: '0/0' },
      { sample_aspect_ratio: '2:1' },
      { pix_fmt: 'yuv420p10le' },
      { color_transfer: 'smpte2084' },
      { color_transfer: 'arib-std-b67' },
      { side_data_list: [{ rotation: 45 }] },
      { codec_type: 'subtitle' },
      { disposition: { attached_pic: 1 } },
      { nb_frames: '999999' },
      { duration: '20' },
    ].map((b) => ({ ...m, streams: [{ ...m.streams[0], ...b }] })),
  ])
    assert.throws(() => parseVideoMetadata(value, readVideoPolicy(), 100));
});
test('bounded media processes keep arguments literal and redact failure diagnostics', async () => {
  const literal = 'name with spaces; $(never-run) & text';
  assert.equal(
    await runMediaProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', literal],
      10000,
    ),
    literal,
  );
  await assert.rejects(
    runMediaProcess(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(10000))'],
      10000,
      128,
    ),
    { reason: 'output' },
  );
  await assert.rejects(runMediaProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 100), {
    reason: 'timeout',
  });
  const c = new AbortController();
  const job = runMediaProcess(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    10000,
    1024,
    c.signal,
  );
  c.abort();
  await assert.rejects(job, { reason: 'abort' });
  await assert.rejects(
    runMediaProcess(
      process.execPath,
      ['-e', 'process.stderr.write("PRIVATE-MEDIA-MARKER");process.exit(3)'],
      10000,
    ),
    (e) => e instanceof Error && !e.message.includes('PRIVATE-MEDIA-MARKER'),
  );
  await assert.rejects(runMediaProcess(resolve('missing-video-executable'), [], 1000), {
    reason: 'start',
  });
});
