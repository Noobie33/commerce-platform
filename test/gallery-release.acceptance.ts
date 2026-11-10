import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { DataSource } from 'typeorm';
import { VideoProcessor } from '../src/infrastructure/media/video-processor.js';
import { VideoArtifactStore } from '../src/infrastructure/media/video-artifact.store.js';
import { readVideoTools } from '../src/infrastructure/media/video-policy.js';
import { runMediaProcess } from '../src/infrastructure/media/bounded-media-process.js';
import { GalleryPublication1794123000000 } from '../src/database/migrations/1794123000000-gallery-publication.js';
import type { GalleryView, GalleryItem } from '../src/modules/catalog/gallery.types.js';
export async function verifyGalleryRelease(c: {
  t: TestContext;
  db: DataSource;
  runtime: DataSource;
  root: string;
  base: string;
  product: string;
  photo: string;
  slug: string;
  actor: string;
  call: (
    path: string,
    body?: unknown,
    who?: number,
    key?: ReturnType<typeof randomUUID>,
  ) => Promise<Response>;
  publish: () => Promise<Response>;
  publicProduct: () => Promise<Response>;
}) {
  const { t, db, runtime, root, base, product, photo, slug, actor, call, publish, publicProduct } =
      c,
    cfg = parseEnv(await readFile('.env.video-worker.test', 'utf8')),
    tools = readVideoTools({
      ...process.env,
      ...cfg,
      VIDEO_WORK_DIR: join(root, 'work'),
      VIDEO_ARTIFACT_DIR: join(root, 'prepared'),
    }),
    video = randomUUID(),
    artifact = randomUUID(),
    file = join(root, 'portrait.mp4');
  await runMediaProcess(
    tools.ffmpeg,
    [
      '-v',
      'error',
      '-nostdin',
      '-n',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x373b3c:size=180x320:rate=24',
      '-t',
      '0.8',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      file,
    ],
    10000,
  );
  const prepared = await new VideoProcessor(tools).process(await readFile(file), 'video/mp4');
  await new VideoArtifactStore(tools.artifactRoot).put(artifact, prepared);
  const manifest = {
    width: prepared.playbackMetadata.width,
    height: prepared.playbackMetadata.height,
    durationSeconds: prepared.playbackMetadata.durationSeconds,
    hasAudio: false,
    originalHash: prepared.originalHash,
    playbackHash: prepared.playbackHash,
    posterHash: prepared.posterHash,
    playbackBytes: prepared.playback.length,
    posterBytes: prepared.poster.length,
  };
  await db.query(
    "INSERT INTO catalog_product_videos(id,product_id,uploader_id,source_type,source_hash,source_bytes,state,artifact_id,manifest,description,review_state) VALUES($1,$2,$3,'video/mp4',$4,$5,'ready',$6,$7::jsonb,'Charcoal shirt portrait turn view','approved')",
    [
      video,
      product,
      actor,
      prepared.originalHash,
      prepared.original.length,
      artifact,
      JSON.stringify(manifest),
    ],
  );
  await db.query(
    "SELECT catalog_video_log($1,$2,$3,'ready','Generated isolated publication fixture')",
    [video, actor, randomUUID()],
  );
  const path = 'products/' + product + '/gallery',
    order: GalleryItem[] = [
      { kind: 'photo', id: photo },
      { kind: 'video', id: video },
    ],
    ok = async (r: Response) => {
      assert.equal(r.status, 200, r.ok ? '' : await r.text());
      return r.json();
    },
    gallery = async () => ok(await call(path)) as Promise<GalleryView>,
    draft = async (items: GalleryItem[]) => {
      const g = await gallery();
      return ok(
        await call(path, {
          action: 'save',
          expectedVersion: g.version,
          expectedBasis: g.basis,
          reason: 'Test ordered mixed gallery',
          items,
        }),
      );
    },
    body = async (action = 'approve') => {
      const r = (await gallery()).publicReview;
      return {
        action,
        expectedVersion: r.version,
        reason: 'Our generated test media reviewed',
        ...(action === 'approve'
          ? {
              expectedDraftVersion: r.currentDraftVersion,
              expectedBasis: r.currentBasis,
              rightsConfirmed: true,
            }
          : {}),
      };
    },
    review = async (action = 'approve') => call(path + '/review', await body(action));
  let url = '',
    poster = '';
  await t.test('mixed gallery draft does not change an existing photo-only release', async () => {
    const before = await ok(await publicProduct());
    await draft(order);
    assert.deepEqual(await ok(await publicProduct()), before);
    assert.equal((await gallery()).publicReview.state, 'not_reviewed');
  });
  await t.test(
    'gallery consent is separate, scoped and cannot accept client file attestations',
    async () => {
      const b = await body();
      assert.equal((await call(path + '/review', b, 1)).status, 403);
      assert.equal((await call(path + '/review', { ...b, rightsConfirmed: false })).status, 400);
      assert.equal(
        (await call(path + '/review', { ...b, verifiedBasis: b.expectedBasis })).status,
        400,
      );
      await assert.rejects(
        runtime.query('UPDATE catalog_gallery_reviews SET state=state'),
        /permission denied/,
      );
      await assert.rejects(
        runtime.query('SELECT catalog_publication_post_v24($1,$2,$3,$4::jsonb)', [
          randomUUID(),
          actor,
          randomUUID(),
          '{}',
        ]),
        /permission denied/,
      );
      await assert.rejects(
        runtime.query('SELECT catalog_release_eligible_v24($1)', [product]),
        /permission denied/,
      );
    },
  );
  let approvalReceipt: {
    body: Awaited<ReturnType<typeof body>>;
    key: ReturnType<typeof randomUUID>;
  };
  await t.test('concurrent approval retries retain one decision without publishing', async () => {
    const b = await body(),
      key = randomUUID(),
      rs = await Promise.all([
        call(path + '/review', b, 0, key),
        call(path + '/review', b, 0, key),
      ]);
    approvalReceipt = { body: b, key };
    for (const r of rs) await ok(r);
    const g = await gallery();
    assert.equal(g.publicReview.version, 1);
    assert.equal(g.publicReview.history.length, 1);
    assert.equal((await ok(await publicProduct())).gallery.length, 1);
  });
  await t.test(
    'explicit publication snapshots ordered native geometry without private identifiers',
    async () => {
      await ok(await publish());
      const p = await ok(await publicProduct());
      assert.deepEqual(
        p.gallery.map((x: { kind: string }) => x.kind),
        ['photo', 'video'],
      );
      assert.equal(p.gallery[1].width, 180);
      assert.equal(p.gallery[1].height, 320);
      assert.equal(p.gallery[1].width / p.gallery[1].height, 9 / 16);
      url = p.gallery[1].url;
      poster = p.gallery[1].thumbnailUrl;
      for (const word of ['playbackHash', 'posterHash', 'artifact_id', 'source_hash', 'basis_hash'])
        assert.ok(!JSON.stringify(p).includes(word));
      const [e] = await db.query(
        "SELECT snapshot FROM catalog_publication_events WHERE product_id=$1 AND kind='release' AND version=$2",
        [product, p.releaseVersion],
      );
      assert.equal(e.snapshot.gallery.items[1].id, video);
    },
  );
  await t.test(
    'public video bytes support safe ranges while originals and foreign scopes remain closed',
    async () => {
      const full = await fetch(base + url),
        bytes = Buffer.from(await full.arrayBuffer());
      assert.equal(full.status, 200);
      assert.equal(full.headers.get('cache-control'), 'no-store');
      assert.deepEqual(bytes, prepared.playback);
      const range = await fetch(base + url, { headers: { Range: 'bytes=0-31' } });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('content-range'), 'bytes 0-31/' + bytes.length);
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 32));
      for (const v of ['bytes=999999999-', 'bytes=0-1,3-5'])
        assert.equal((await fetch(base + url, { headers: { Range: v } })).status, 416);
      assert.equal((await fetch(base + poster)).status, 200);
      assert.equal((await fetch(base + url.replace('/playback', '/original'))).status, 404);
      assert.equal((await fetch(base + url.replace(slug, 'foreign-' + slug))).status, 404);
    },
  );
  await t.test(
    'changing only an editorial draft does not replace or withdraw a live snapshot',
    async () => {
      const before = await ok(await publicProduct());
      await draft([...order].reverse());
      assert.deepEqual(await ok(await publicProduct()), before);
      assert.equal((await gallery()).publicReview.matchesDraft, false);
      await draft(order);
    },
  );
  await t.test(
    'tampered derivatives are denied and cannot receive a new public approval',
    async () => {
      const target = join(tools.artifactRoot, artifact, 'poster.webp');
      await writeFile(target, Buffer.from('tampered'));
      try {
        assert.equal((await fetch(base + poster)).status, 404);
        await ok(await call(path + '/review', approvalReceipt.body, 0, approvalReceipt.key));
        assert.equal((await review()).status, 409);
      } finally {
        await writeFile(target, prepared.poster);
      }
      assert.equal((await fetch(base + poster)).status, 200);
    },
  );
  await t.test(
    'changed selected metadata withdraws old access and republishing requires fresh review',
    async () => {
      await db.query(
        "UPDATE catalog_product_videos SET version=version+1,description='Updated portrait view' WHERE id=$1",
        [video],
      );
      await db.query(
        "SELECT catalog_video_log($1,$2,$3,'metadata','Test changed reviewed metadata')",
        [video, actor, randomUUID()],
      );
      assert.equal((await fetch(base + url)).status, 404);
      assert.equal((await publicProduct()).status, 404);
      assert.equal((await publish()).status, 409);
      await ok(await review());
      await ok(await publish());
      const p = await ok(await publicProduct());
      assert.equal((await fetch(base + url)).status, 404);
      url = p.gallery[1].url;
      poster = p.gallery[1].thumbnailUrl;
      assert.equal((await fetch(base + url)).status, 200);
    },
  );
  await t.test(
    'revocation closes old URLs and subsequent explicit photo-only release excludes videos',
    async () => {
      await ok(await review('revoke'));
      assert.equal((await fetch(base + url)).status, 404);
      assert.equal((await publicProduct()).status, 404);
      await ok(await publish());
      assert.equal((await ok(await publicProduct())).gallery.length, 1);
      assert.equal((await fetch(base + url)).status, 404);
    },
  );
  await t.test('audio and non-primary-first drafts cannot gain public approval', async () => {
    await draft([...order].reverse());
    assert.equal((await review()).status, 409);
    await draft(order);
    await db.query(
      "UPDATE catalog_product_videos SET manifest=jsonb_set(manifest,'{hasAudio}','true'::jsonb) WHERE id=$1",
      [video],
    );
    try {
      assert.equal((await review()).status, 409);
    } finally {
      await db.query('UPDATE catalog_product_videos SET manifest=$2::jsonb WHERE id=$1', [
        video,
        JSON.stringify(manifest),
      ]);
    }
  });
  await t.test(
    'review audit failure rolls back history and leaves the retry reusable',
    async () => {
      const b = await body(),
        key = randomUUID(),
        before = (await gallery()).publicReview.version;
      await db.query(
        "CREATE FUNCTION gallery_review_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='catalog.gallery_approve' THEN RAISE EXCEPTION 'forced audit failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER gallery_review_test_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION gallery_review_test_fail();",
      );
      try {
        assert.equal((await call(path + '/review', b, 0, key)).status, 500);
        assert.equal((await gallery()).publicReview.version, before);
        assert.equal(
          (await db.query('SELECT 1 FROM catalog_gallery_review_requests WHERE key=$1', [key]))
            .length,
          0,
        );
      } finally {
        await db.query(
          'DROP TRIGGER gallery_review_test_fail ON audit_events;DROP FUNCTION gallery_review_test_fail()',
        );
      }
      await ok(await call(path + '/review', b, 0, key));
    },
  );
  await t.test(
    'concurrent withdrawal beats publication and cached publish replay cannot restore video',
    async () => {
      const p = await ok(await call('products/' + product + '/publication')),
        publishBody = {
          action: 'publish',
          expectedVersion: p.version,
          expectedProductVersion: p.productVersion,
          expectedContentVersion: p.contentVersion,
          reason: 'Race acceptance publish',
        },
        key = randomUUID();
      await ok(await call('products/' + product + '/publication', publishBody, 0, key));
      const current = await ok(await publicProduct()),
        live = current.gallery[1].url;
      const revokeBody = await body('revoke'),
        fresh = await ok(await call('products/' + product + '/publication'));
      const rs = await Promise.all([
        call(path + '/review', revokeBody),
        call('products/' + product + '/publication', {
          ...publishBody,
          expectedVersion: fresh.version,
        }),
      ]);
      for (const r of rs) assert.ok([200, 409].includes(r.status));
      assert.equal((await fetch(base + live)).status, 404);
      const visible = await publicProduct();
      if (visible.status === 200) {
        const p = await visible.json();
        assert.ok(p.gallery.every((x: { kind: string }) => x.kind === 'photo'));
      } else assert.equal(visible.status, 404);
      const before = await db.query(
        'SELECT version,snapshot FROM catalog_releases WHERE product_id=$1',
        [product],
      );
      const events = await db.query(
        'SELECT count(*)::int AS n FROM catalog_publication_events WHERE product_id=$1',
        [product],
      );
      await ok(await call('products/' + product + '/publication', publishBody, 0, key));
      assert.deepEqual(
        await db.query('SELECT version,snapshot FROM catalog_releases WHERE product_id=$1', [
          product,
        ]),
        before,
      );
      assert.deepEqual(
        await db.query(
          'SELECT count(*)::int AS n FROM catalog_publication_events WHERE product_id=$1',
          [product],
        ),
        events,
      );
      assert.equal((await fetch(base + live)).status, 404);
    },
  );
  await t.test('current review permission is checked before a cached SQL replay', async () => {
    const b = await body(),
      key = randomUUID();
    await ok(await call(path + '/review', b, 0, key));
    await db.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [actor]);
    try {
      await assert.rejects(
        runtime.query('SELECT catalog_gallery_review_post($1,$2,$3,$4::jsonb)', [
          key,
          actor,
          randomUUID(),
          JSON.stringify({ ...b, productId: product, verifiedBasis: b.expectedBasis }),
        ]),
        /GALLERY_REVIEW_PERMISSION/,
      );
    } finally {
      await db.query(
        "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
        [actor],
      );
    }
  });
  await t.test(
    'compiled gallery publication upgrade preserves data and refuses history loss',
    async () => {
      const migration = new GalleryPublication1794123000000(),
        r = db.createQueryRunner();
      await r.connect();
      try {
        await assert.rejects(migration.down(r), /Cannot discard/);
        await r.startTransaction();
        const schema = 'gallery_release_' + randomUUID().replaceAll('-', '');
        await r.query('CREATE SCHEMA ' + schema);
        await r.query('SET LOCAL search_path TO ' + schema + ',public');
        for (const prior of db.migrations) {
          if (prior instanceof GalleryPublication1794123000000) break;
          await prior.up(r);
        }
        const before = await r.query(
          'SELECT code,label,fields FROM catalog_content_profiles ORDER BY code',
        );
        await migration.up(r);
        assert.deepEqual(
          await r.query('SELECT code,label,fields FROM catalog_content_profiles ORDER BY code'),
          before,
        );
        await migration.down(r);
        await migration.up(r);
        await r.rollbackTransaction();
      } finally {
        if (r.isTransactionActive) await r.rollbackTransaction();
        await r.release();
      }
    },
  );
  await ok(await review('revoke'));
  await ok(await publish());
}
