import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
import { LocalMediaStore } from '../infrastructure/media/local-media.store.js';
const name = new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname;
if (!['/commerce_platform_dev', '/commerce_platform_test'].includes(name))
  throw Error('Local project databases only');
const source = createRuntimeDataSource(),
  store = new LocalMediaStore(process.env);
try {
  await source.initialize();
  const rows: {
    id: string;
    hash: string;
    bytes: number;
    active: boolean;
    originalHash: string | null;
    originalBytes: number | null;
  }[] = await source.query(
    'SELECT id,content_hash AS hash,byte_size AS bytes,is_active AS active,original_hash AS "originalHash",original_bytes AS "originalBytes" FROM catalog_product_photos',
  );
  const expected = new Set(
    rows.flatMap((row) => [
      row.id + '-image.webp',
      row.id + '-thumbnail.webp',
      ...(row.originalHash ? [row.id + '-original.bin'] : []),
    ]),
  );
  let entries: string[] = [];
  try {
    entries = await readdir(store.root);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  let invalid = 0;
  for (const row of rows) {
    try {
      const image = await store.read(row.id, 'image');
      const thumbnail = await store.read(row.id, 'thumbnail');
      if (row.originalHash) {
        const original = await store.read(row.id, 'original');
        if (
          original.length !== row.originalBytes ||
          createHash('sha256').update(original).digest('hex') !== row.originalHash
        ) {
          invalid++;
          continue;
        }
      }
      if (
        image.length !== row.bytes ||
        createHash('sha256').update(image).digest('hex') !== row.hash ||
        !thumbnail.length
      )
        invalid++;
    } catch {
      invalid++;
    }
  }
  const unexpected = entries.filter((file) => !expected.has(file)).length;
  console.info(
    JSON.stringify({
      records: rows.length,
      active: rows.filter((row) => row.active).length,
      invalidOrMissing: invalid,
      unreferencedEntries: unexpected,
    }),
  );
  if (invalid || unexpected) process.exitCode = 1;
} catch {
  console.error(
    'Media verification failed. Check database and protected media storage. No files changed.',
  );
  process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
