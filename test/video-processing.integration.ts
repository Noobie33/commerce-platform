import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { VideoProcessor, videoHash } from '../src/infrastructure/media/video-processor.js';
import { VideoArtifactStore } from '../src/infrastructure/media/video-artifact.store.js';
import { readVideoPolicy, readVideoTools } from '../src/infrastructure/media/video-policy.js';
import { runMediaProcess } from '../src/infrastructure/media/bounded-media-process.js';
import { privateVideoRoot } from '../src/infrastructure/media/video-workspace.js';

test('video preparation: actual codecs, original integrity, private artifacts and failure cleanup', async (t) => {
  const configured = readVideoTools(process.env),
    root = await mkdtemp(join(tmpdir(), 'commerce-video-integration-')),
    tools = {
      ...configured,
      workRoot: join(root, 'private work'),
      artifactRoot: join(root, 'private artifacts'),
    },
    policy = readVideoPolicy();
  const previousWork = process.env.VIDEO_WORK_DIR,
    previousArtifacts = process.env.VIDEO_ARTIFACT_DIR;
  process.env.VIDEO_WORK_DIR = tools.workRoot;
  process.env.VIDEO_ARTIFACT_DIR = tools.artifactRoot;
  const processor = new VideoProcessor(tools, policy);
  let original: Buffer, prepared: Awaited<ReturnType<VideoProcessor['process']>>;
  const sourceFile = join(root, 'sample clip.mp4');
  async function fixture(file: string, audio = true) {
    await runMediaProcess(
      tools.ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-n',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x394b53:size=320x240:rate=24',
        ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'] : []),
        '-t',
        '1.2',
        '-map',
        '0:v:0',
        ...(audio ? ['-map', '1:a:0', '-c:a', 'aac'] : ['-an']),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '1',
        '-metadata',
        'comment=PRIVATE-QA-METADATA',
        '-metadata:s:v:0',
        'title=PRIVATE-QA-METADATA',
        file,
      ],
      20000,
    );
    return readFile(file);
  }
  try {
    original = await fixture(sourceFile);
    await t.test(
      'actual playback and poster preserve the original while stripping source metadata',
      async () => {
        prepared = await processor.process(original, 'video/mp4');
        assert.deepEqual(prepared.original, original);
        assert.equal(prepared.originalHash, videoHash(original));
        assert.equal(prepared.playbackMetadata.videoCodec, 'h264');
        assert.equal(prepared.playbackMetadata.audioCodec, 'aac');
        assert.equal(prepared.playbackMetadata.hasAudio, true);
        assert.equal(prepared.playbackMetadata.width, 320);
        assert.equal(prepared.playbackMetadata.height, 240);
        assert.equal(prepared.playbackHash, videoHash(prepared.playback));
        assert.equal(prepared.posterHash, videoHash(prepared.poster));
        const poster = await sharp(prepared.poster).metadata();
        assert.equal(poster.format, 'webp');
        assert.equal(poster.exif, undefined);
        assert.equal(poster.xmp, undefined);
        const file = join(root, 'sanitized.mp4');
        await writeFile(file, prepared.playback);
        const info = await runMediaProcess(
          tools.ffprobe,
          ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
          10000,
        );
        assert.equal(info.includes('PRIVATE-QA-METADATA'), false);
        assert.ok(
          prepared.playback.indexOf(Buffer.from('moov')) <
            prepared.playback.indexOf(Buffer.from('mdat')),
        );
        assert.deepEqual(await readdir(tools.workRoot), []);
      },
    );
    await t.test('silent clips stay silent without an invented audio track', async () => {
      const clip = await fixture(join(root, 'silent.mp4'), false),
        v = await processor.process(clip, 'video/mp4');
      assert.equal(v.source.hasAudio, false);
      assert.equal(v.playbackMetadata.hasAudio, false);
    });
    await t.test(
      'portrait rotation is applied to playback and its display-sized poster',
      async () => {
        const file = join(root, 'rotated.mp4');
        await runMediaProcess(
          tools.ffmpeg,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-n',
            '-display_rotation:v:0',
            '90',
            '-i',
            sourceFile,
            '-c',
            'copy',
            file,
          ],
          10000,
        );
        const v = await processor.process(await readFile(file), 'video/mp4');
        assert.equal(v.source.displayWidth, 240);
        assert.equal(v.source.displayHeight, 320);
        assert.equal(v.playbackMetadata.width, 240);
        assert.equal(v.playbackMetadata.height, 320);
        assert.equal(v.playbackMetadata.rotation, 0);
        assert.ok(v.posterHeight > v.posterWidth);
      },
    );
    await t.test(
      'QuickTime MOV is inspected and preserved, while a mismatched container label is rejected',
      async () => {
        const file = join(root, 'sample.mov');
        await runMediaProcess(
          tools.ffmpeg,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-n',
            '-i',
            sourceFile,
            '-c',
            'copy',
            '-f',
            'mov',
            file,
          ],
          10000,
        );
        const bytes = await readFile(file),
          v = await processor.process(bytes, 'video/quicktime');
        assert.deepEqual(v.original, bytes);
        assert.equal(v.originalType, 'video/quicktime');
        await assert.rejects(processor.process(bytes, 'video/mp4'), { status: 422 });
      },
    );
    await t.test(
      'bounded resize produces even dimensions and never enlarges the source',
      async () => {
        const v = await new VideoProcessor(tools, { ...policy, maxPlaybackEdge: 160 }).process(
          original,
          'video/mp4',
        );
        assert.equal(v.playbackMetadata.width, 160);
        assert.equal(v.playbackMetadata.height, 120);
      },
    );
    await t.test(
      'spoofed, corrupt and oversized input fails before it becomes an artifact',
      async () => {
        for (const [b, type] of [
          [Buffer.alloc(0), 'video/mp4'],
          [Buffer.from('<html>not video</html>'), 'video/mp4'],
          [original, 'image/png'],
          [original.subarray(0, 40), 'video/mp4'],
        ] as const)
          await assert.rejects(processor.process(b, type), { status: 422 });
        await assert.rejects(
          new VideoProcessor(tools, { ...policy, maxSourceBytes: 32 }).process(
            original,
            'video/mp4',
          ),
          { status: 422 },
        );
        assert.deepEqual(await readdir(tools.workRoot), []);
      },
    );
    await t.test(
      'duration and output bounds reject truncation instead of accepting a shortened video',
      async () => {
        await assert.rejects(
          new VideoProcessor(tools, { ...policy, maxDurationSeconds: 1 }).process(
            original,
            'video/mp4',
          ),
          { status: 422 },
        );
        await assert.rejects(
          new VideoProcessor(tools, { ...policy, maxPlaybackBytes: 128 }).process(
            original,
            'video/mp4',
          ),
          { status: 422 },
        );
        assert.deepEqual(await readdir(tools.workRoot), []);
      },
    );
    await t.test(
      'a timed-out transcode is terminated and leaves no partial workspace',
      async () => {
        await assert.rejects(
          new VideoProcessor(tools, { ...policy, processingTimeoutMs: 1 }).process(
            original,
            'video/mp4',
          ),
          { status: 422 },
        );
        assert.deepEqual(await readdir(tools.workRoot), []);
      },
    );
    await t.test(
      'the process-wide concurrency budget rejects a second job and recovers',
      async () => {
        const one = processor.process(original, 'video/mp4');
        await assert.rejects(new VideoProcessor(tools).process(original, 'video/mp4'), {
          status: 503,
        });
        await one;
        assert.deepEqual(await readdir(tools.workRoot), []);
      },
    );
    await t.test(
      'cancelled and unavailable tool jobs clean their workspace and release capacity',
      async () => {
        const c = new AbortController();
        c.abort();
        await assert.rejects(processor.process(original, 'video/mp4', c.signal), { status: 422 });
        await assert.rejects(
          new VideoProcessor({ ...tools, ffprobe: join(root, 'missing-ffprobe') }).process(
            original,
            'video/mp4',
          ),
          { status: 503 },
        );
        const v = await processor.process(original, 'video/mp4');
        assert.equal(v.playbackMetadata.videoCodec, 'h264');
        assert.deepEqual(await readdir(tools.workRoot), []);
      },
    );
    await t.test(
      'prepared bundles are private and immutable, with verified original/playback/poster hashes',
      async () => {
        const store = new VideoArtifactStore(tools.artifactRoot),
          id = randomUUID(),
          dir = await store.put(id, prepared);
        const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
        assert.equal(manifest.state, 'prepared_private');
        assert.equal(manifest.hashes.original, videoHash(original));
        assert.deepEqual(await readFile(join(dir, 'original.bin')), original);
        await assert.rejects(store.put(id, prepared));
        await assert.rejects(store.put('../escape', prepared));
        const bad = randomUUID();
        await assert.rejects(store.put(bad, { ...prepared, posterHash: '0'.repeat(64) }));
        assert.equal((await readdir(tools.artifactRoot)).includes(bad), false);
      },
    );
    await t.test(
      'private roots reject redirected directories and web asset locations',
      async () => {
        await assert.rejects(privateVideoRoot(resolve('dist/public/video-test')));
        const target = join(root, 'target'),
          link = join(root, 'redirect');
        await mkdir(target);
        await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(privateVideoRoot(link));
      },
    );
    await t.test(
      'local preparation command creates a private handoff without publishing or changing its input',
      async () => {
        const cli = fileURLToPath(new URL('../src/scripts/prepare-video.js', import.meta.url));
        const output = await runMediaProcess(process.execPath, [cli, sourceFile], 120000);
        const result = JSON.parse(output);
        assert.equal(result.state, 'prepared_private');
        assert.equal(result.originalUnchanged, true);
        assert.equal(dirname(result.directory), tools.artifactRoot);
        assert.deepEqual(await readFile(sourceFile), original);
        assert.equal(
          JSON.parse(await readFile(join(result.directory, 'manifest.json'), 'utf8')).hashes
            .original,
          videoHash(original),
        );
      },
    );
  } finally {
    if (previousWork === undefined) delete process.env.VIDEO_WORK_DIR;
    else process.env.VIDEO_WORK_DIR = previousWork;
    if (previousArtifacts === undefined) delete process.env.VIDEO_ARTIFACT_DIR;
    else process.env.VIDEO_ARTIFACT_DIR = previousArtifacts;
    if (!root.startsWith(join(tmpdir(), 'commerce-video-integration-')))
      throw Error('Unsafe integration cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});
