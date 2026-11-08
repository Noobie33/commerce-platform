import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ImageProcessor, MAX_IMAGE_BYTES } from '../src/infrastructure/media/image-processor.js';
import { LocalMediaStore } from '../src/infrastructure/media/local-media.store.js';
import { ProductMediaService } from '../src/modules/catalog/media.service.js';
import type { DataSource } from 'typeorm';
test('image decoding re-encodes allowed formats, bounds dimensions, rotates and strips metadata', async () => {
  const processor = new ImageProcessor();
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const input = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#bf6d2a' },
    })
      .toFormat(format)
      .withExif({ IFD0: { Artist: 'Private camera owner' } })
      .toBuffer();
    const output = await processor.process(input, 'image/' + (format === 'jpeg' ? 'jpeg' : format));
    assert.equal(output.width, 1600);
    assert.equal(output.height, 1067);
    const metadata = await sharp(output.image).metadata(),
      thumb = await sharp(output.thumbnail).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.ok(thumb.width! <= 480 && thumb.height! <= 480);
  }
  const portrait = await sharp({
    create: { width: 20, height: 10, channels: 3, background: 'red' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const output = await processor.process(portrait, 'image/jpeg');
  assert.equal(output.width, 10);
  assert.equal(output.height, 20);
});
test('image decoding rejects spoofed, corrupt, oversized, animated and high-pixel inputs', async () => {
  const processor = new ImageProcessor(),
    png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .png()
      .toBuffer();
  for (const [body, type] of [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png'],
    [png, 'image/jpeg'],
    [png.subarray(0, 30), 'image/png'],
    [Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'],
  ] as const)
    await assert.rejects(processor.process(body, type), { status: 422 });
  const huge = await sharp({
    create: { width: 5000, height: 4000, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  await assert.rejects(processor.process(huge, 'image/png'), { status: 422 });
  const pixels = Buffer.from([
    255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255,
  ]);
  const animated = await sharp(pixels, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(processor.process(animated, 'image/webp'), { status: 422 });
});
test('local media objects are immutable, recover partial writes and reject path keys/config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'commerce-media-test-'));
  try {
    const store = new LocalMediaStore({ MEDIA_STORAGE_DIR: root }),
      id = randomUUID();
    const image = {
      image: Buffer.from('full'),
      thumbnail: Buffer.from('thumb'),
      width: 1,
      height: 1,
    };
    await store.put(id, image);
    await assert.rejects(store.put(id, image));
    assert.equal((await store.read(id, 'image')).toString(), 'full');
    const partial = randomUUID();
    await writeFile(join(root, partial + '-thumbnail.webp'), 'existing');
    await assert.rejects(store.put(partial, image));
    assert.equal((await readdir(root)).includes(partial + '-image.webp'), false);
    assert.equal((await store.read(partial, 'thumbnail')).toString(), 'existing');
    await assert.rejects(store.read('../outside', 'image'));
    assert.throws(() => new LocalMediaStore({ MEDIA_STORAGE_DIR: 'relative-path' }));
    const production = new LocalMediaStore({ NODE_ENV: 'production' });
    await assert.rejects(production.put(randomUUID(), image), { status: 503 });
  } finally {
    if (
      !resolve(root).startsWith(resolve(tmpdir()) + sep) ||
      !basename(root).startsWith('commerce-media-test-')
    )
      throw Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
test('upload work is bounded before receiving bytes and releases its slots on failure', async () => {
  const service = new ProductMediaService(
    {} as DataSource,
    new ImageProcessor(),
    {} as LocalMediaStore,
  );
  const releases: (() => void)[] = [];
  const work = () => service.receive(() => new Promise<void>((resolve) => releases.push(resolve)));
  const first = work(),
    second = work();
  await assert.rejects(work(), { status: 503 });
  releases.forEach((release) => release());
  await Promise.all([first, second]);
  await assert.rejects(
    service.receive(async () => {
      throw Error('fixture failure');
    }),
  );
  await service.receive(async () => undefined);
});
