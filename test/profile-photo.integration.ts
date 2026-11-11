import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import {
  createDataSource,
  createRuntimeDataSource,
  databaseUrl,
} from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { StaffProfilePhotos1794124000000 } from '../src/database/migrations/1794124000000-staff-profile-photos.js';
import { IdentityFoundation1794096000000 } from '../src/database/migrations/1794096000000-identity-foundation.js';
test('private staff profile photos: own account, bounded images, audit and concurrent versions', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource(),
    ids = [randomUUID(), randomUUID(), randomUUID()],
    sessions = ids.map(() => randomUUID()),
    tokens = ids.map(() => randomBytes(32).toString('base64url')),
    csrf = randomBytes(32).toString('hex'),
    suffix = randomBytes(5).toString('hex'),
    env = { ...process.env, STAFF_ORIGIN: 'http://profile.test' };
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  await db.initialize();
  await db.runMigrations();
  await grantRuntime(db, env);
  await runtime.initialize();
  try {
    for (let i = 0; i < 3; i++) {
      await db.query(
        'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password)VALUES($1,$2,$3,$4,$5)',
        [ids[i], 'photo_' + suffix + '_' + i, 'Photo test staff', 'unused-test-hash', i === 2],
      );
      await db.query(
        'INSERT INTO staff_sessions(id,staff_id,token_hash,csrf_token)VALUES($1,$2,$3,$4)',
        [sessions[i], ids[i], tokenHash(tokens[i]!), csrf],
      );
    }
    app = await createApp(env);
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl(),
      base = origin + '/api/v1/staff/me',
      image = await sharp({
        create: { width: 600, height: 400, channels: 3, background: '#54756a' },
      })
        .jpeg()
        .withMetadata({ exif: { IFD0: { Artist: 'Private metadata' } } })
        .toBuffer();
    const headers = (who = 0) => ({
        Origin: env.STAFF_ORIGIN,
        'X-Requested-With': 'commerce-staff',
        'X-CSRF-Token': csrf,
        Cookie: 'commerce_session=' + tokens[who],
      }),
      upload = (v: number, body: Buffer = image, who = 0, extra = {}) =>
        fetch(base + '/photo', {
          method: 'POST',
          headers: {
            ...headers(who),
            'Content-Type': 'image/jpeg',
            'X-Photo-Version': String(v),
            ...extra,
          },
          body: new Uint8Array(body),
        }),
      remove = (v: number) =>
        fetch(base + '/photo/remove', {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedVersion: v }),
        });
    await t.test(
      'anonymous, forced-password, missing CSRF and cross-origin uploads are denied',
      async () => {
        assert.equal((await fetch(base + '/photo/1')).status, 401);
        assert.equal((await upload(0, image, 2)).status, 403);
        assert.equal((await upload(0, image, 0, { 'X-CSRF-Token': '' })).status, 403);
        assert.equal((await upload(0, image, 0, { Origin: 'http://foreign.test' })).status, 403);
      },
    );
    await t.test(
      'upload saves only a stripped square avatar and returns private fresh metadata',
      async () => {
        let r = await upload(0);
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { version: 1, hasPhoto: true });
        r = await fetch(base, { headers: headers() });
        assert.deepEqual((await r.json()).profilePhoto, { version: 1, hasPhoto: true });
        r = await fetch(base + '/photo/1', { headers: headers() });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.equal(r.headers.get('content-type'), 'image/webp');
        const bytes = Buffer.from(await r.arrayBuffer()),
          meta = await sharp(bytes).metadata();
        assert.equal(meta.width, 256);
        assert.equal(meta.height, 256);
        assert.equal(meta.exif, undefined);
        assert.equal(meta.format, 'webp');
        assert.ok(bytes.length <= 262144);
      },
    );
    await t.test(
      'no arbitrary staff photo URL and no cross-account or original access',
      async () => {
        assert.equal((await fetch(base + '/photo/1', { headers: headers(1) })).status, 404);
        assert.equal((await fetch(base + '/photo/' + ids[0], { headers: headers(1) })).status, 400);
        assert.equal(
          (await fetch(base + '/photo/1?staffId=' + ids[0], { headers: headers(1) })).status,
          404,
        );
        assert.equal((await fetch(base + '/photo/original', { headers: headers() })).status, 400);
      },
    );
    await t.test(
      'invalid, encoded and excessive upload inputs leave the prior photo untouched',
      async () => {
        assert.equal((await upload(1, Buffer.from('<svg>untrusted</svg>'))).status, 422);
        assert.equal((await upload(1, image, 0, { 'Content-Encoding': 'gzip' })).status, 400);
        const oversized = await new Promise<number>((resolve, reject) => {
          const r = httpRequest(
            base + '/photo',
            {
              method: 'POST',
              headers: {
                ...headers(),
                'Content-Type': 'image/jpeg',
                'X-Photo-Version': '1',
                'Content-Length': String(5 * 1024 * 1024 + 1),
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode!);
            },
          );
          r.on('error', reject);
          r.setTimeout(5000, () => r.destroy(new Error('Upload bound response timeout')));
          r.flushHeaders();
        });
        assert.equal(oversized, 413);
        const pixels = await sharp({
          create: { width: 4100, height: 4000, channels: 3, background: '#ddd' },
        })
          .png()
          .toBuffer();
        assert.equal((await upload(1, pixels, 0, { 'Content-Type': 'image/png' })).status, 422);
        assert.deepEqual((await (await fetch(base, { headers: headers() })).json()).profilePhoto, {
          version: 1,
          hasPhoto: true,
        });
      },
    );
    await t.test(
      'concurrent saves have one winner and stale retries cannot overwrite it',
      async () => {
        const r = await Promise.all([upload(1), upload(1)]);
        assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
        assert.equal((await upload(1)).status, 409);
      },
    );
    await t.test(
      'removal clears private bytes but retains a revision to reject old uploads',
      async () => {
        assert.equal((await remove(2)).status, 200);
        assert.equal((await fetch(base + '/photo/2', { headers: headers() })).status, 404);
        assert.equal((await upload(2)).status, 409);
        assert.deepEqual((await (await fetch(base, { headers: headers() })).json()).profilePhoto, {
          version: 3,
          hasPhoto: false,
        });
        const [p] = await db.query('SELECT image FROM staff_profile_photos WHERE staff_id=$1', [
          ids[0],
        ]);
        assert.equal(p.image, null);
      },
    );
    await t.test(
      'runtime cannot directly read/write photo storage; revoked sessions fail inside the function',
      async () => {
        await assert.rejects(runtime.query('SELECT * FROM staff_profile_photos'), {
          code: '42501',
        });
        await assert.rejects(runtime.query('UPDATE staff_profile_photos SET image=NULL'), {
          code: '42501',
        });
        await assert.rejects(
          runtime.query('SELECT public.staff_profile_photo_write($1,$2,$3,0,NULL)', [
            ids[1],
            sessions[0],
            randomUUID(),
          ]),
        );
        await db.query('UPDATE staff_sessions SET revoked_at=now() WHERE id=$1', [sessions[1]]);
        await assert.rejects(
          runtime.query('SELECT * FROM public.staff_profile_photo_read($1,$2,false)', [
            ids[1],
            sessions[1],
          ]),
        );
      },
    );
    await t.test(
      'audit failure rolls back the photo revision and logs contain no bytes or filename',
      async () => {
        const fn = 'photo_audit_' + suffix;
        try {
          await db.query(
            'CREATE FUNCTION ' +
              fn +
              "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'staff.photo_%' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$",
          );
          await db.query(
            'CREATE TRIGGER ' +
              fn +
              ' BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ' +
              fn +
              '()',
          );
          assert.equal((await upload(3)).status, 500);
          assert.deepEqual(
            (await (await fetch(base, { headers: headers() })).json()).profilePhoto,
            { version: 3, hasPhoto: false },
          );
        } finally {
          await db.query('DROP TRIGGER IF EXISTS ' + fn + ' ON audit_events');
          await db.query('DROP FUNCTION IF EXISTS ' + fn + '()');
        }
        const rows = await db.query(
          "SELECT metadata FROM audit_events WHERE actor_id=$1 AND action LIKE 'staff.photo_%' ORDER BY created_at",
          [ids[0]],
        );
        assert.equal(rows.length, 3);
        assert.deepEqual(
          rows.map((x: { metadata: unknown }) => x.metadata),
          [{ version: 1 }, { version: 2 }, { version: 3 }],
        );
      },
    );
    await t.test(
      'migration applies/reverts in isolation and refuses discarding a saved revision',
      async () => {
        const q = db.createQueryRunner(),
          schema = 'photo_probe_' + suffix;
        try {
          await q.startTransaction();
          await q.query('CREATE SCHEMA ' + schema);
          await q.query('SET LOCAL search_path TO ' + schema + ',pg_catalog');
          await new IdentityFoundation1794096000000().up(q);
          await q.query('UPDATE app_schema_version SET version=25');
          const m = new StaffProfilePhotos1794124000000();
          await m.up(q);
          assert.equal((await q.query('SELECT version FROM app_schema_version'))[0].version, 26);
          await m.down(q);
          assert.equal((await q.query('SELECT version FROM app_schema_version'))[0].version, 25);
          await m.up(q);
          await q.query(
            "INSERT INTO staff_users(id,username,display_name,password_hash)VALUES($1,'photo_probe','Test','unused')",
            [ids[0]],
          );
          await q.query('INSERT INTO staff_profile_photos(staff_id,version)VALUES($1,1)', [ids[0]]);
          await assert.rejects(m.down(q), /Cannot discard/);
        } finally {
          if (q.isTransactionActive) await q.rollbackTransaction();
          await q.release();
        }
      },
    );
  } finally {
    await app?.close();
    await runtime.destroy();
    await db.transaction(async (m) => {
      await m.query('DELETE FROM staff_profile_photos WHERE staff_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [ids]);
    });
    await db.destroy();
  }
});
