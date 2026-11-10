import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { createApp } from '../src/app.js';
import {
  createDataSource,
  createRuntimeDataSource,
  databaseUrl,
} from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import {
  videoWorkerSource,
  assertVideoWorker,
  VideoWorker,
} from '../src/modules/catalog/video-worker.js';
import { runMediaProcess } from '../src/infrastructure/media/bounded-media-process.js';
import { VideoIntakeStore } from '../src/infrastructure/media/video-intake.store.js';
import { CatalogVideoIntake1794121000000 } from '../src/database/migrations/1794121000000-catalog-video-intake.js';

test('private video intake: actual uploads, durable worker fencing, review boundaries and retained history', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource(),
    root = await mkdtemp(join(tmpdir(), 'commerce-video-intake-')),
    workerConfig = parseEnv(await readFile('.env.video-worker.test', 'utf8'));
  const env = {
      ...process.env,
      ...workerConfig,
      FFMPEG_PATH: workerConfig.FFMPEG_PATH!,
      FFPROBE_PATH: workerConfig.FFPROBE_PATH!,
      VIDEO_QUARANTINE_DIR: join(root, 'incoming'),
      VIDEO_ARTIFACT_DIR: join(root, 'prepared'),
      VIDEO_WORK_DIR: join(root, 'work'),
      VIDEO_INTAKE_MODE: 'local-development',
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
    },
    workerDB = videoWorkerSource(env);
  const users = Array.from({ length: 4 }, () => randomUUID()),
    roles = Array.from({ length: 3 }, () => randomUUID()),
    tokens = users.map(() => randomBytes(32).toString('base64url')),
    csrf = users.map(() => randomBytes(32).toString('hex')),
    products = [randomUUID(), randomUUID()],
    variants = [randomUUID(), randomUUID()],
    suffix = randomBytes(4).toString('hex'),
    origin = 'http://video-intake.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '',
    first = '',
    clip: Buffer = Buffer.alloc(0);
  const store = new VideoIntakeStore(env.VIDEO_QUARANTINE_DIR),
    hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const headers = (who = 0) => ({
    Origin: origin,
    'X-Requested-With': 'commerce-staff',
    Cookie: 'commerce_session=' + tokens[who],
    'X-CSRF-Token': csrf[who]!,
  });
  const upload = (key = randomUUID(), who = 0, bytes = clip, pid = products[0]) =>
    fetch(base + '/api/v1/catalog/products/' + pid + '/videos', {
      method: 'POST',
      headers: {
        ...headers(who),
        'Content-Type': 'video/mp4',
        'X-Product-Version': '1',
        'X-Idempotency-Key': key,
      },
      body: new Uint8Array(bytes),
    });
  const list = async (pid = products[0]) => {
    const r = await fetch(base + '/api/v1/catalog/products/' + pid + '/videos', {
      headers: headers(),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  const get = async (id: string) => {
    const p = await list();
    return p.items.find((v: { id: string }) => v.id === id);
  };
  const action = (id: string, b: Record<string, unknown>, who = 0, key = randomUUID()) =>
    fetch(
      base +
        '/api/v1/catalog/videos/' +
        id +
        (['approve', 'revoke'].includes(String(b.action)) ? '/review' : ''),
      {
        method: 'POST',
        headers: { ...headers(who), 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
        body: JSON.stringify(b),
      },
    );
  const act = async (id: string, op: string, extra: Record<string, unknown> = {}, who = 0) => {
    const v = await get(id);
    return action(
      id,
      {
        action: op,
        expectedVersion: v.version,
        reason: 'Isolated video acceptance decision',
        ...extra,
      },
      who,
    );
  };
  try {
    await db.initialize();
    await db.runMigrations();
    await grantRuntime(db, process.env);
    await runtime.initialize();
    await workerDB.initialize();
    await assertVideoWorker(workerDB);
    for (let i = 0; i < users.length; i++) {
      await db.query(
        "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Video test staff','not-a-login-hash',false)",
        [users[i], 'video.test.' + suffix + i],
      );
      await db.query(
        'INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)',
        [users[i], tokenHash(tokens[i]!), csrf[i]],
      );
    }
    await db.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [users[0]],
    );
    for (let i = 0; i < roles.length; i++) {
      await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [roles[i], 'video_' + suffix + i]);
      await db.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.read')",
        [roles[i]],
      );
      if (i !== 1)
        await db.query('INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)', [
          roles[i],
          i === 0 ? 'catalog.manage' : 'catalog.media.review',
        ]);
      await db.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2)', [
        users[i + 1],
        roles[i],
      ]);
    }
    for (let i = 0; i < products.length; i++) {
      await db.query(
        "INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,$2,'Video acceptance shirt','active')",
        [products[i], ('VIDEO' + suffix + i).toUpperCase()],
      );
      await db.query(
        'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,129000,$5::jsonb)',
        [
          variants[i],
          products[i],
          ('VIDEO-' + suffix + i).toUpperCase(),
          'a'.repeat(64),
          JSON.stringify({ size: 'M' }),
        ],
      );
    }
    const source = join(root, 'source.mp4');
    await runMediaProcess(
      env.FFMPEG_PATH!,
      [
        '-v',
        'error',
        '-nostdin',
        '-n',
        '-f',
        'lavfi',
        '-i',
        'color=c=green:size=160x120:rate=24',
        '-t',
        '0.6',
        '-an',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '1',
        source,
      ],
      10000,
    );
    clip = await readFile(source);
    app = await createApp({
      ...env,
      DATABASE_URL: process.env.DATABASE_URL!,
      MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL!,
      STAFF_ORIGIN: origin,
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const worker = new VideoWorker(workerDB, env);
    await t.test(
      'upload authentication, origin, CSRF and permissions are checked before storage',
      async () => {
        const url = base + '/api/v1/catalog/products/' + products[0] + '/videos';
        assert.equal(
          (
            await fetch(url, {
              method: 'POST',
              headers: {
                ...headers(),
                'X-CSRF-Token': 'bad',
                'Content-Type': 'video/mp4',
                'X-Product-Version': '1',
                'X-Idempotency-Key': randomUUID(),
              },
              body: new Uint8Array(clip),
            })
          ).status,
          403,
        );
        assert.equal((await upload(randomUUID(), 2)).status, 403);
        assert.equal(
          (
            await fetch(url, {
              method: 'POST',
              headers: {
                Origin: origin,
                'X-Requested-With': 'commerce-staff',
                'Content-Type': 'video/mp4',
              },
              body: new Uint8Array(clip),
            })
          ).status,
          401,
        );
        assert.equal((await upload(randomUUID(), 0, Buffer.from('not an mp4 input'))).status, 400);
        assert.equal((await list()).total, 0);
      },
    );
    const uploadKey = randomUUID();
    await t.test(
      'concurrent duplicate intake creates one durable job and preserves original bytes',
      async () => {
        const replies = await Promise.all([upload(uploadKey), upload(uploadKey)]);
        assert.deepEqual(
          replies.map((r) => r.status),
          [201, 201],
        );
        const a = await replies[0]!.json(),
          b = await replies[1]!.json();
        assert.deepEqual(a, b);
        first = a.id;
        assert.equal((await list()).total, 1);
        assert.equal((await get(first)).state, 'queued');
        assert.deepEqual(await store.read(first, hash(clip)), clip);
        assert.equal((await store.ids()).length, 1);
        assert.equal(
          (await upload(uploadKey, 0, Buffer.concat([clip, Buffer.from('x')]))).status,
          409,
        );
        assert.equal((await store.ids()).length, 1);
      },
    );
    await t.test(
      'worker and web database roles cannot bypass each other or write raw job state',
      async () => {
        await assert.rejects(workerDB.query('SELECT * FROM staff_users'), /permission denied/);
        await assert.rejects(
          workerDB.query("UPDATE catalog_product_videos SET state='ready'"),
          /permission denied/,
        );
        await assert.rejects(
          runtime.query('SELECT catalog_video_claim($1,$2)', [randomUUID(), randomUUID()]),
          /permission denied/,
        );
        await assert.rejects(
          runtime.query('DELETE FROM catalog_video_events'),
          /permission denied/,
        );
      },
    );
    await t.test(
      'actual background conversion commits ready metadata and preserves the first response cache',
      async () => {
        assert.equal(await worker.once(), true);
        const v = await get(first);
        assert.equal(v.state, 'ready');
        assert.equal(v.reviewState, 'not_reviewed');
        assert.equal(v.attempts, 1);
        assert.equal(v.width, 160);
        const history = await fetch(base + '/api/v1/catalog/videos/' + first + '/history', {
          headers: headers(),
        });
        assert.equal((await history.json()).items[0].snapshot.performedBy, 'video_worker');
        const replay = await upload(uploadKey);
        assert.equal(replay.status, 201);
        assert.equal((await replay.json()).version, 1);
        assert.equal((await get(first)).state, 'ready');
        const json = JSON.stringify(await list());
        for (const key of [
          'source_hash',
          'sourceHash',
          'lease_token',
          'artifact_id',
          'manifest',
          'FFMPEG_PATH',
        ])
          assert.equal(json.includes(key), false);
      },
    );
    await t.test(
      'private playback supports safe ranges while originals require management permission',
      async () => {
        const url = base + '/api/v1/catalog/videos/' + first;
        const r = await fetch(url + '/playback', {
          headers: { ...headers(2), Range: 'bytes=0-31' },
        });
        assert.equal(r.status, 206);
        assert.equal(r.headers.get('content-type'), 'video/mp4');
        assert.ok(r.headers.get('content-range')!.startsWith('bytes 0-31/'));
        assert.equal((await r.arrayBuffer()).byteLength, 32);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.equal(
          (await fetch(url + '/playback', { headers: { ...headers(), Range: 'bytes=999999999-' } }))
            .status,
          416,
        );
        assert.equal((await fetch(url + '/playback')).status, 401);
        assert.equal((await fetch(url + '/original', { headers: headers(2) })).status, 403);
        const original = await fetch(url + '/original', { headers: headers(1) });
        assert.equal(original.status, 200);
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), clip);
        assert.match(original.headers.get('content-disposition')!, /^attachment;/);
        assert.equal(
          (await fetch(base + '/api/v1/store/videos/' + first + '/playback')).status,
          404,
        );
      },
    );
    await t.test(
      'variant metadata, private review and revocation stay separately authorized and versioned',
      async () => {
        assert.equal(
          (
            await act(
              first,
              'metadata',
              {
                description: 'Cotton shirt, front and side view',
                variantId: variants[1],
                position: 1,
              },
              1,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await act(
              first,
              'metadata',
              {
                description: 'Cotton shirt, front and side view',
                variantId: variants[0],
                position: 1,
              },
              1,
            )
          ).status,
          200,
        );
        assert.equal((await act(first, 'approve', { rightsConfirmed: true }, 1)).status, 403);
        assert.equal((await act(first, 'approve', { rightsConfirmed: false }, 3)).status, 400);
        assert.equal((await act(first, 'approve', { rightsConfirmed: true }, 3)).status, 200);
        assert.equal((await get(first)).reviewState, 'approved');
        assert.equal((await act(first, 'revoke', {}, 3)).status, 200);
        assert.equal((await get(first)).reviewState, 'revoked');
        const hist = await fetch(base + '/api/v1/catalog/videos/' + first + '/history', {
          headers: headers(2),
        });
        assert.equal(hist.status, 200);
        assert.ok((await hist.json()).items.length >= 5);
      },
    );
    await t.test(
      'corrupt prepared bytes are denied without changing retained review facts',
      async () => {
        const [row] = await db.query('SELECT artifact_id FROM catalog_product_videos WHERE id=$1', [
            first,
          ]),
          file = join(env.VIDEO_ARTIFACT_DIR, row.artifact_id, 'poster.webp'),
          bytes = await readFile(file);
        try {
          await writeFile(file, Buffer.from('corrupt'));
          assert.equal(
            (
              await fetch(base + '/api/v1/catalog/videos/' + first + '/poster', {
                headers: headers(),
              })
            ).status,
            404,
          );
          assert.equal((await act(first, 'approve', { rightsConfirmed: true }, 3)).status, 409);
        } finally {
          await writeFile(file, bytes);
        }
      },
    );
    await t.test('invalid media remains failed and private instead of becoming ready', async () => {
      const r = await upload(randomUUID(), 0, clip.subarray(0, 40));
      assert.equal(r.status, 201);
      const id = (await r.json()).id;
      assert.equal(await worker.once(), true);
      assert.equal((await get(id)).state, 'failed');
      assert.equal((await get(id)).errorCode, 'invalid_video');
      assert.equal((await act(id, 'remove')).status, 200);
    });
    await t.test(
      'worker shutdown queues a valid clip for retry rather than labelling it invalid',
      async () => {
        const r = await upload();
        assert.equal(r.status, 201);
        const id = (await r.json()).id,
          c = new AbortController();
        c.abort();
        await worker.once(c.signal);
        const v = await get(id);
        assert.equal(v.state, 'queued');
        assert.equal(v.errorCode, 'processing_failed');
        assert.equal((await act(id, 'remove')).status, 200);
      },
    );
    await t.test(
      'concurrent workers share one database-wide processing admission budget',
      async () => {
        const a = await upload(),
          b = await upload();
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        const ids = [(await a.json()).id, (await b.json()).id];
        const results = await Promise.all([
          workerDB.query('SELECT catalog_video_claim($1,$2) AS job', [randomUUID(), randomUUID()]),
          workerDB.query('SELECT catalog_video_claim($1,$2) AS job', [randomUUID(), randomUUID()]),
        ]);
        assert.equal(results.filter((r) => r[0].job !== null).length, 1);
        for (const id of ids) assert.equal((await act(id, 'remove')).status, 200);
      },
    );
    await t.test('lease expiry and cancellation fence stale worker completions', async () => {
      const r = await upload();
      assert.equal(r.status, 201);
      const id = (await r.json()).id,
        token = randomUUID();
      const [j] = await workerDB.query('SELECT catalog_video_claim($1,$2) AS job', [
        token,
        randomUUID(),
      ]);
      assert.equal(j.job.id, id);
      assert.equal(
        (
          await workerDB.query('SELECT catalog_video_claim($1,$2) AS job', [
            randomUUID(),
            randomUUID(),
          ])
        )[0].job,
        null,
      );
      await db.query(
        "UPDATE catalog_product_videos SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
      assert.equal(
        (
          await workerDB.query(
            "SELECT catalog_video_finish($1,$2,$3,NULL,'processing_failed') AS ok",
            [id, token, randomUUID()],
          )
        )[0].ok,
        false,
      );
      await workerDB.query('SELECT catalog_video_claim($1,$2)', [randomUUID(), randomUUID()]);
      await db.query(
        'UPDATE catalog_product_videos SET available_at=clock_timestamp() WHERE id=$1',
        [id],
      );
      const next = randomUUID();
      assert.equal(
        (await workerDB.query('SELECT catalog_video_claim($1,$2) AS job', [next, randomUUID()]))[0]
          .job.id,
        id,
      );
      assert.equal(
        (await workerDB.query('SELECT catalog_video_heartbeat($1,$2) AS ok', [id, token]))[0].ok,
        false,
      );
      assert.equal((await act(id, 'cancel')).status, 200);
      assert.equal(
        (
          await workerDB.query("SELECT catalog_video_finish($1,$2,$3,NULL,'invalid_video') AS ok", [
            id,
            next,
            randomUUID(),
          ])
        )[0].ok,
        false,
      );
      assert.equal((await act(id, 'retry')).status, 200);
      assert.equal((await act(id, 'remove')).status, 200);
      assert.equal(
        (await fetch(base + '/api/v1/catalog/videos/' + id + '/original', { headers: headers() }))
          .status,
        404,
      );
    });
    await t.test(
      'audit failure rolls back intake state/history/cache and its source is safely cleaned',
      async () => {
        const before = await store.ids(),
          key = randomUUID();
        await db.query(
          "CREATE FUNCTION video_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='catalog.video_upload' THEN RAISE EXCEPTION 'forced video audit failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER video_test_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION video_test_audit_fail();",
        );
        try {
          assert.equal((await upload(key)).status, 500);
          assert.deepEqual((await store.ids()).sort(), before.sort());
          assert.equal(
            (await db.query('SELECT 1 FROM catalog_video_requests WHERE key=$1', [key])).length,
            0,
          );
        } finally {
          await db.query(
            'DROP TRIGGER video_test_audit_fail ON audit_events;DROP FUNCTION video_test_audit_fail()',
          );
        }
        const r = await upload(key);
        assert.equal(r.status, 201);
        assert.equal((await act((await r.json()).id, 'remove')).status, 200);
      },
    );
    await t.test('fresh action permissions are required before cached replays', async () => {
      await db.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [users[0]]);
      try {
        assert.equal((await upload(uploadKey)).status, 403);
      } finally {
        await db.query(
          "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
          [users[0]],
        );
      }
    });
    await t.test(
      'reconciliation is reference-aware and never deletes retained originals',
      async () => {
        const report = await worker.reconcile();
        assert.equal(report.mode, 'report_only');
        assert.equal(report.missingSources, 0);
        assert.equal(report.missingArtifacts, 0);
        assert.equal(report.unreferencedSources, 0);
        assert.equal(report.unreferencedArtifacts, 0);
        assert.deepEqual(await store.read(first, hash(clip)), clip);
      },
    );
    await t.test(
      'schema upgrade preserves prior facts and downgrade refuses retained video history',
      async () => {
        const migration = new CatalogVideoIntake1794121000000(),
          r = db.createQueryRunner();
        await r.connect();
        try {
          await assert.rejects(migration.down(r), /Cannot discard/);
          await r.startTransaction();
          const schema = 'video_scratch_' + suffix;
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET LOCAL search_path TO ' + schema + ',public');
          for (const prior of db.migrations) {
            if (prior instanceof CatalogVideoIntake1794121000000) break;
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
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 22);
          await migration.up(r);
          await r.rollbackTransaction();
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
      },
    );
  } finally {
    await app?.close();
    if (workerDB.isInitialized) await workerDB.destroy();
    if (runtime.isInitialized) await runtime.destroy();
    if (db.isInitialized) {
      await db.transaction(async (m) => {
        await m.query('DELETE FROM catalog_video_requests WHERE actor_id=ANY($1::uuid[])', [users]);
        await m.query(
          'DELETE FROM catalog_video_events WHERE video_id IN(SELECT id FROM catalog_product_videos WHERE product_id=ANY($1::uuid[]))',
          [products],
        );
        await m.query('DELETE FROM catalog_product_videos WHERE product_id=ANY($1::uuid[])', [
          products,
        ]);
        await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM catalog_variants WHERE product_id=ANY($1::uuid[])', [products]);
        await m.query('DELETE FROM catalog_products WHERE id=ANY($1::uuid[])', [products]);
        await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [roles]);
        await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [roles]);
      });
      await db.destroy();
    }
    if (!root.startsWith(join(tmpdir(), 'commerce-video-intake-')))
      throw Error('Unsafe test cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});
