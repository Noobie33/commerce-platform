import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import {
  createDataSource,
  createRuntimeDataSource,
  databaseUrl,
} from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { CatalogGalleryDrafts1794122000000 } from '../src/database/migrations/1794122000000-catalog-gallery-drafts.js';
import type { GalleryView, GalleryItem } from '../src/modules/catalog/gallery.types.js';
test('private gallery drafts: real HTTP, concurrent revisions, current media, audit and migration retention', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource(),
    users = [randomUUID(), randomUUID()],
    tokens = users.map(() => randomBytes(32).toString('base64url')),
    csrf = users.map(() => randomBytes(32).toString('hex')),
    products = [randomUUID(), randomUUID()],
    photos = [randomUUID(), randomUUID()],
    videos = [randomUUID(), randomUUID()],
    variant = randomUUID(),
    role = randomUUID(),
    suffix = randomBytes(5).toString('hex'),
    origin = 'http://gallery.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '';
  const headers = (who = 0) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: 'commerce_session=' + tokens[who],
    'X-CSRF-Token': csrf[who]!,
  });
  const path = '/api/v1/catalog/products/' + products[0] + '/gallery';
  const call = (body?: unknown, who = 0, key = randomUUID()) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers(who), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const view = async () => {
    const r = await call();
    assert.equal(r.status, 200);
    return r.json() as Promise<GalleryView>;
  };
  const items: GalleryItem[] = [
    { kind: 'photo', id: photos[0]! },
    { kind: 'video', id: videos[0]! },
  ];
  const input = async (order = items) => {
    const v = await view();
    return {
      action: 'save',
      expectedVersion: v.version,
      expectedBasis: v.basis,
      reason: 'Isolated gallery editorial decision',
      items: order,
    };
  };
  try {
    await db.initialize();
    await db.runMigrations();
    await grantRuntime(db, process.env);
    await runtime.initialize();
    for (let i = 0; i < users.length; i++) {
      await db.query(
        "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Gallery test staff','not-a-login-hash',false)",
        [users[i], 'gallery.' + suffix + i],
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
    await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [role, 'gallery_' + suffix]);
    await db.query("INSERT INTO role_permissions VALUES($1,'catalog.read')", [role]);
    await db.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2)', [
      users[1],
      role,
    ]);
    for (let i = 0; i < products.length; i++) {
      await db.query(
        "INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,$2,'Gallery acceptance shirt','active')",
        [products[i], ('GAL' + suffix + i).toUpperCase()],
      );
      await db.query(
        'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash,is_primary) VALUES($1,$2,400,480,100,$3,true)',
        [photos[i], products[i], 'a'.repeat(64)],
      );
      await db.query(
        "INSERT INTO catalog_product_videos(id,product_id,uploader_id,source_type,source_hash,source_bytes,state,artifact_id,manifest,description,review_state) VALUES($1,$2,$3,'video/mp4',$4,100,'ready',$5,$6::jsonb,'Cotton shirt turn view','approved')",
        [
          videos[i],
          products[i],
          users[0],
          'b'.repeat(64),
          randomUUID(),
          JSON.stringify({
            width: 400,
            height: 480,
            durationSeconds: 1,
            hasAudio: false,
            playbackHash: 'c'.repeat(64),
            posterHash: 'd'.repeat(64),
          }),
        ],
      );
    }
    await db.query(
      'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,129000,$5::jsonb)',
      [
        variant,
        products[0],
        ('GAL-' + suffix).toUpperCase(),
        'e'.repeat(64),
        JSON.stringify({ size: 'M' }),
      ],
    );
    app = await createApp({ ...process.env, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    await t.test(
      'anonymous, CSRF and reader permissions protect drafts before writes',
      async () => {
        assert.equal((await fetch(base + path)).status, 401);
        assert.equal((await call(undefined, 1)).status, 200);
        assert.equal((await call(await input(), 1)).status, 403);
        assert.equal(
          (
            await fetch(base + path, {
              method: 'POST',
              headers: { ...headers(), 'X-CSRF-Token': 'invalid' },
              body: JSON.stringify(await input()),
            })
          ).status,
          403,
        );
        assert.equal((await view()).version, 0);
      },
    );
    await t.test(
      'runtime cannot bypass gallery functions or expose private metadata in DTOs',
      async () => {
        await assert.rejects(
          runtime.query('INSERT INTO catalog_gallery_drafts VALUES($1,1,$2)', [products[0], '[]']),
          /permission denied/i,
        );
        await assert.rejects(
          runtime.query('UPDATE catalog_gallery_events SET reason=reason'),
          /permission denied/i,
        );
        const v = await view();
        assert.equal(v.assets.length, 2);
        const json = JSON.stringify(v);
        for (const secret of [
          'source_hash',
          'artifact_id',
          'playbackHash',
          'posterHash',
          'c'.repeat(64),
          'b'.repeat(64),
        ])
          assert.ok(!json.includes(secret));
      },
    );
    let firstInput: Awaited<ReturnType<typeof input>>,
      firstKey = randomUUID();
    await t.test(
      'concurrent same-key saves retain one ordered draft, history and audit',
      async () => {
        firstInput = await input();
        const rs = await Promise.all([
          call(firstInput, 0, firstKey),
          call(firstInput, 0, firstKey),
        ]);
        for (const r of rs) assert.equal(r.status, 200, await r.text());
        const v = await view();
        assert.equal(v.version, 1);
        assert.deepEqual(v.items, items);
        assert.equal(v.history.length, 1);
        assert.equal(
          (
            await db.query(
              "SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='catalog.gallery_save'",
              [users[0]],
            )
          ).length,
          1,
        );
        assert.equal(
          (await call({ ...firstInput, reason: 'Changed semantic request' }, 0, firstKey)).status,
          409,
        );
      },
    );
    await t.test(
      'different concurrent edits cannot silently overwrite the winning order',
      async () => {
        const b = await input(),
          rs = await Promise.all([
            call({ ...b, items: [...items].reverse() }),
            call({ ...b, items: [items[0]] }),
          ]);
        assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await view()).version, 2);
      },
    );
    await t.test(
      'media review and variant changes invalidate the read token before save',
      async () => {
        const b = await input();
        await db.query(
          'UPDATE catalog_product_videos SET version=version+1,variant_id=$2 WHERE id=$1',
          [videos[0], variant],
        );
        assert.equal((await call(b)).status, 409);
        const fresh = await input();
        await db.query('UPDATE catalog_variants SET is_active=false WHERE id=$1', [variant]);
        assert.equal((await call(fresh)).status, 409);
        assert.equal((await call(await input())).status, 409);
        await db.query('UPDATE catalog_variants SET is_active=true WHERE id=$1', [variant]);
        assert.equal((await call(await input())).status, 200);
      },
    );
    await t.test(
      'cross-product, duplicate, stale and injected media IDs are rejected',
      async () => {
        for (const invalid of [
          [{ kind: 'photo', id: photos[1] }],
          [{ kind: 'video', id: videos[1] }],
          [items[0], items[0]],
        ])
          assert.ok(
            [400, 409].includes((await call({ ...(await input()), items: invalid })).status),
          );
        assert.equal((await call({ ...(await input()), publish: true })).status, 400);
        const b = await input();
        await db.query(
          'UPDATE catalog_product_photos SET is_active=false,is_primary=false WHERE id=$1',
          [photos[0]],
        );
        assert.equal((await call(b)).status, 409);
        const v = await view();
        assert.ok(v.issues.some((x) => x.includes('unavailable')));
        assert.equal((await call({ ...(await input()), items: [] })).status, 200);
        await db.query(
          'UPDATE catalog_product_photos SET is_active=true,is_primary=true WHERE id=$1',
          [photos[0]],
        );
      },
    );
    await t.test(
      'private approvals and draft save never alter public release or product facts',
      async () => {
        const before = await db.query('SELECT public.catalog_release_basis($1) AS basis', [
          products[0],
        ]);
        const product = await db.query('SELECT version FROM catalog_products WHERE id=$1', [
          products[0],
        ]);
        assert.equal((await call(await input())).status, 200);
        assert.deepEqual(
          await db.query('SELECT public.catalog_release_basis($1) AS basis', [products[0]]),
          before,
        );
        assert.deepEqual(
          await db.query('SELECT version FROM catalog_products WHERE id=$1', [products[0]]),
          product,
        );
        assert.equal(
          (await db.query('SELECT 1 FROM catalog_releases WHERE product_id=$1', [products[0]]))
            .length,
          0,
        );
        assert.equal((await fetch(base + '/api/v1/store/products/gallery-' + suffix)).status, 404);
      },
    );
    await t.test(
      'database permission checks apply before replay after grant revocation',
      async () => {
        await db.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [users[0]]);
        try {
          await assert.rejects(
            runtime.query('SELECT public.catalog_gallery_post($1,$2,$3,$4::jsonb)', [
              firstKey,
              users[0],
              randomUUID(),
              JSON.stringify({ ...firstInput, productId: products[0] }),
            ]),
            /GALLERY_PERMISSION/,
          );
        } finally {
          await db.query(
            "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
            [users[0]],
          );
        }
      },
    );
    await t.test('audit failure rolls back order, history and idempotency receipt', async () => {
      const b = await input([...items].reverse()),
        key = randomUUID(),
        before = await view();
      await db.query(
        "CREATE FUNCTION gallery_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='catalog.gallery_save' THEN RAISE EXCEPTION 'forced gallery audit failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER gallery_test_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION gallery_test_audit_fail();",
      );
      try {
        assert.equal((await call(b, 0, key)).status, 500);
        assert.equal((await view()).version, before.version);
        assert.equal(
          (await db.query('SELECT 1 FROM catalog_gallery_requests WHERE key=$1', [key])).length,
          0,
        );
      } finally {
        await db.query(
          'DROP TRIGGER gallery_test_audit_fail ON audit_events;DROP FUNCTION gallery_test_audit_fail()',
        );
      }
      assert.equal((await call(b, 0, key)).status, 200);
    });
    await t.test(
      'compiled additive migration refuses history loss and re-applies on an empty isolated schema',
      async () => {
        const migration = new CatalogGalleryDrafts1794122000000(),
          r = db.createQueryRunner();
        await r.connect();
        try {
          await assert.rejects(migration.down(r), /Cannot discard/);
          await r.startTransaction();
          const schema = 'gallery_scratch_' + suffix;
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET LOCAL search_path TO ' + schema + ',public');
          for (const prior of db.migrations) {
            if (prior instanceof CatalogGalleryDrafts1794122000000) break;
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
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 23);
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
    if (runtime.isInitialized) await runtime.destroy();
    if (db.isInitialized) {
      await db.transaction(async (m) => {
        await m.query('DELETE FROM catalog_gallery_requests WHERE actor_id=ANY($1::uuid[])', [
          users,
        ]);
        await m.query('DELETE FROM catalog_gallery_events WHERE product_id=ANY($1::uuid[])', [
          products,
        ]);
        await m.query('DELETE FROM catalog_gallery_drafts WHERE product_id=ANY($1::uuid[])', [
          products,
        ]);
        await m.query('DELETE FROM catalog_product_videos WHERE product_id=ANY($1::uuid[])', [
          products,
        ]);
        await m.query('DELETE FROM catalog_product_photos WHERE product_id=ANY($1::uuid[])', [
          products,
        ]);
        await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM catalog_variants WHERE product_id=ANY($1::uuid[])', [products]);
        await m.query('DELETE FROM catalog_products WHERE id=ANY($1::uuid[])', [products]);
        await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM role_permissions WHERE role_id=$1', [role]);
        await m.query('DELETE FROM roles WHERE id=$1', [role]);
      });
      await db.destroy();
    }
  }
});
