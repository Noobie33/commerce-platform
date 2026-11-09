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
import { CatalogMerchandising1794115000000 } from '../src/database/migrations/1794115000000-catalog-merchandising.js';
import type { MerchInput, GuideDefinition } from '../src/modules/catalog/merch.types.js';
import type { ContentView } from '../src/modules/catalog/content.types.js';
test('merchandising: exact versioned charts, collections, atomic content and review compatibility', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource();
  await db.initialize();
  await db.runMigrations();
  await grantRuntime(db, process.env);
  await runtime.initialize();
  const suffix = randomBytes(4).toString('hex'),
    users = Array.from({ length: 4 }, () => randomUUID()),
    roles = [randomUUID(), randomUUID(), randomUUID()],
    scopedLocation = randomUUID(),
    tokens = users.map(() => randomBytes(32).toString('base64url')),
    csrf = users.map(() => randomBytes(32).toString('hex')),
    product = randomUUID(),
    variant = randomUUID(),
    category = randomUUID(),
    photo = randomUUID(),
    guide = randomUUID(),
    collection = randomUUID(),
    collection2 = randomUUID(),
    created = new Set([guide, collection, collection2]),
    origin = 'http://merch.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '';
  const headers = (i = 0) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: 'commerce_session=' + tokens[i],
    'X-CSRF-Token': csrf[i]!,
  });
  async function call(path: string, body?: unknown, who = 0, key = randomUUID()) {
    return fetch(base + '/api/v1/catalog/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers(who), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const body = (id = guide): MerchInput => ({
    id,
    kind: 'size_guide',
    slug: 'merch-guide-' + suffix,
    expectedVersion: 0,
    reason: 'Verified garment measurements',
    definition: {
      title: 'Verified shirt chart',
      active: true,
      unit: 'cm',
      basis: 'garment',
      instructions: 'Measure the garment flat.',
      columns: ['Chest', 'Length'],
      rows: [{ size: 'M', values: ['98.50', '72.00'] }],
    },
  });
  const collectionBody = (id: string, slug: string): MerchInput => ({
    id,
    kind: 'collection',
    slug: slug + '-' + suffix,
    expectedVersion: 0,
    reason: 'Create curated grouping',
    definition: { title: slug, active: true, description: 'Private merchandising collection' },
  });
  const cpath = 'products/' + product + '/content';
  const view = async () => {
    const r = await call(cpath);
    assert.equal(r.status, 200);
    return r.json() as Promise<ContentView>;
  };
  const fields = {
    profile: 'clothing-v1',
    slug: 'merch-product-' + suffix,
    description: 'A comfortable cotton shirt.',
    specifications: { material: 'Cotton', care: 'Gentle wash', fit: 'regular' },
  };
  async function content(action: string, extra: Record<string, unknown> = {}, key = randomUUID()) {
    const v = await view();
    return call(
      cpath,
      {
        action,
        expectedVersion: v.record?.version ?? 0,
        expectedProductVersion: v.productVersion,
        ...(action === 'save' ? fields : {}),
        ...extra,
      },
      0,
      key,
    );
  }
  try {
    await db.transaction(async (m) => {
      for (let i = 0; i < users.length; i++) {
        await m.query(
          "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Merch integration staff','not-login-hash',false)",
          [users[i], 'merch.test.' + suffix + i],
        );
        await m.query(
          'INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)',
          [users[i], tokenHash(tokens[i]!), csrf[i]],
        );
      }
      for (const id of [users[0], users[3]])
        await m.query(
          "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
          [id],
        );
      for (let i = 0; i < roles.length; i++)
        await m.query('INSERT INTO roles(id,code) VALUES($1,$2)', [
          roles[i],
          'merch_' + suffix + i,
        ]);
      await m.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.read'),($1,'catalog.content.manage'),($2,'catalog.read')",
        roles.slice(0, 2),
      );
      await m.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2),($3,$4)', [
        users[1],
        roles[0],
        users[2],
        roles[1],
      ]);
      await m.query("INSERT INTO locations(id,code,name) VALUES($1,$2,'Scoped test location')", [
        scopedLocation,
        'MERCHSCOPE' + suffix.toUpperCase(),
      ]);
      await m.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.merch.manage')",
        [roles[2]],
      );
      await m.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
        [users[1], roles[2], scopedLocation],
      );
      await m.query('INSERT INTO catalog_categories(id,name,name_key) VALUES($1,$2,$3)', [
        category,
        'Merch category ' + suffix,
        'merch category ' + suffix,
      ]);
      await m.query(
        "INSERT INTO catalog_products(id,style_code,name,category_id,status) VALUES($1,$2,'Merch test shirt',$3,'active')",
        [product, 'MERCH' + suffix.toUpperCase(), category],
      );
      await m.query(
        'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,129000,\'{"size":"M"}\')',
        [variant, product, 'MERCH-' + suffix.toUpperCase(), 'e'.repeat(64)],
      );
      await m.query(
        'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash,is_primary) VALUES($1,$2,64,64,100,$3,true)',
        [photo, product, 'a'.repeat(64)],
      );
    });
    app = await createApp({ ...process.env, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    await t.test(
      'read and separate library-write permissions protect HTTP and raw SQL',
      async () => {
        assert.equal((await fetch(base + '/api/v1/catalog/merchandising')).status, 401);
        assert.equal((await call('merchandising', undefined, 2)).status, 200);
        assert.equal((await call('merchandising', body(), 1)).status, 403);
        assert.equal((await call('merchandising', body(), 2)).status, 403);
        const h = headers();
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        assert.equal(
          (
            await fetch(base + '/api/v1/catalog/merchandising', {
              method: 'POST',
              headers: h,
              body: JSON.stringify(body()),
            })
          ).status,
          403,
        );
        for (const sql of [
          "INSERT INTO catalog_merch_items VALUES('" +
            randomUUID() +
            "','size_guide','forbidden',1)",
          'DELETE FROM catalog_merch_versions',
        ])
          await assert.rejects(
            runtime.query(sql),
            (e) =>
              !!e &&
              typeof e === 'object' &&
              'driverError' in e &&
              (e.driverError as { code: string }).code === '42501',
          );
        await assert.rejects(
          runtime.query('SELECT catalog_merch_post($1,$2,$3,$4::jsonb)', [
            randomUUID(),
            users[1],
            randomUUID(),
            JSON.stringify(body()),
          ]),
          /CONTENT_PERMISSION/,
        );
      },
    );
    await t.test(
      'concurrent retries create one exact chart and enforce actor/body identity',
      async () => {
        const key = randomUUID();
        const results = await Promise.all([
          call('merchandising', body(), 0, key),
          call('merchandising', body(), 0, key),
        ]);
        assert.deepEqual(
          results.map((x) => x.status),
          [200, 200],
        );
        assert.deepEqual(await results[0]!.json(), await results[1]!.json());
        const r = await call('merchandising/' + guide);
        assert.equal(r.status, 200);
        const x = await r.json();
        assert.equal(x.history.length, 1);
        assert.equal(x.item.definition.rows[0].values[0], '98.50');
        assert.equal(
          (await call('merchandising', { ...body(), reason: 'Changed body' }, 0, key)).status,
          409,
        );
        assert.equal((await call('merchandising', body(), 3, key)).status, 409);
        assert.equal(
          (await call('merchandising', collectionBody(collection, 'new-arrivals'))).status,
          200,
        );
        assert.equal(
          (await call('merchandising', collectionBody(collection2, 'festive-edit'))).status,
          200,
        );
      },
    );
    await t.test(
      'direct SQL validation rejects invalid grids and rolling back audit failure leaves no library row or retry key',
      async () => {
        for (const definition of [
          { ...body().definition, rows: [{ size: 'M', values: ['0', '72'] }] },
          { ...body().definition, columns: ['Chest', 'chest'] },
          { ...body().definition, rows: [{ size: 'M', values: ['98'] }] },
        ])
          await assert.rejects(
            runtime.query('SELECT catalog_merch_post($1,$2,$3,$4::jsonb)', [
              randomUUID(),
              users[0],
              randomUUID(),
              JSON.stringify({ ...body(randomUUID()), definition }),
            ]),
            /MERCH_INVALID/,
          );
        const id = randomUUID(),
          key = randomUUID();
        created.add(id);
        const input = { ...body(id), slug: 'audit-' + suffix };
        const fn = 'merch_audit_' + suffix;
        await db.query(
          `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.actor_id='${users[0]}'::uuid AND NEW.action='catalog.merch_saved' THEN RAISE EXCEPTION 'forced audit failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
        );
        try {
          assert.equal((await call('merchandising', input, 0, key)).status, 500);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM catalog_merch_items WHERE id=$1', [id])
            )[0].n,
            0,
          );
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM catalog_merch_requests WHERE key=$1', [
                key,
              ])
            )[0].n,
            0,
          );
        } finally {
          await db.query(`DROP TRIGGER ${fn} ON audit_events;DROP FUNCTION ${fn}()`);
        }
        assert.equal((await call('merchandising', input, 0, key)).status, 200);
      },
    );
    await t.test(
      'legacy content retains its snapshot shape until attachments are selected',
      async () => {
        assert.equal((await content('save')).status, 200);
        assert.equal((await view()).preview.merchandising, undefined);
        assert.equal((await content('submit')).status, 200);
        assert.equal(
          (await content('approve', { reason: 'Owner reviewed the base copy' })).status,
          200,
        );
        assert.equal((await view()).current, true);
      },
    );
    await t.test(
      'guide and multiple collection assignments save atomically with content history and replay protection',
      async () => {
        const before = await view(),
          key = randomUUID();
        const input = {
          action: 'save',
          ...fields,
          expectedVersion: before.record!.version,
          expectedProductVersion: before.productVersion,
          merchandising: {
            sizeGuide: { id: guide, version: 1 },
            collections: [
              { id: collection, version: 1 },
              { id: collection2, version: 1 },
            ],
          },
        };
        assert.equal((await call(cpath, input, 0, key)).status, 200);
        assert.equal((await call(cpath, input, 0, key)).status, 200);
        const after = await view();
        assert.equal(after.record!.version, before.record!.version + 1);
        assert.equal(after.preview.merchandising!.sizeGuide!.version, 1);
        assert.equal(after.preview.merchandising!.collections.length, 2);
        assert.equal(
          (after.preview.merchandising!.sizeGuide!.definition as GuideDefinition).rows[0]!
            .values[0],
          '98.50',
        );
        assert.equal(
          (
            await call(
              cpath,
              { ...input, merchandising: { sizeGuide: null, collections: [] } },
              0,
              key,
            )
          ).status,
          409,
        );
        const bad = {
          ...input,
          expectedVersion: after.record!.version,
          merchandising: { sizeGuide: { id: collection, version: 1 }, collections: [] },
        };
        assert.equal((await call(cpath, bad)).status, 400);
        assert.equal((await view()).preview.merchandising!.collections.length, 2);
      },
    );
    await t.test(
      'content audit failure restores links, revision and retry namespaces',
      async () => {
        const before = await view(),
          key = randomUUID(),
          fn = 'merch_content_audit_' + suffix;
        const input = {
          action: 'save',
          ...fields,
          expectedVersion: before.record!.version,
          expectedProductVersion: before.productVersion,
          merchandising: { sizeGuide: null, collections: [] },
        };
        await db.query(
          `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.actor_id='${users[0]}'::uuid AND NEW.action='catalog.content_save' THEN RAISE EXCEPTION 'forced content audit failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
        );
        try {
          assert.equal((await call(cpath, input, 0, key)).status, 500);
          const after = await view();
          assert.equal(after.record!.version, before.record!.version);
          assert.deepEqual(after.preview.merchandising, before.preview.merchandising);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM catalog_merch_requests WHERE key=$1', [
                key,
              ])
            )[0].n,
            0,
          );
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM catalog_content_requests WHERE key=$1',
                [key],
              )
            )[0].n,
            0,
          );
        } finally {
          await db.query(`DROP TRIGGER ${fn} ON audit_events;DROP FUNCTION ${fn}()`);
        }
        assert.equal((await call(cpath, input, 0, key)).status, 200);
        assert.equal(
          (
            await content('save', {
              merchandising: {
                sizeGuide: { id: guide, version: 1 },
                collections: [
                  { id: collection, version: 1 },
                  { id: collection2, version: 1 },
                ],
              },
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'submitted content is frozen and historical guide versions do not change with the library',
      async () => {
        assert.equal((await content('submit')).status, 200);
        assert.equal(
          (await content('save', { merchandising: { sizeGuide: null, collections: [] } })).status,
          409,
        );
        assert.equal(
          (await content('approve', { reason: 'Owner checked measurements and collections' }))
            .status,
          200,
        );
        const approved = await view();
        const next = {
          ...body(),
          expectedVersion: 1,
          definition: {
            ...body().definition,
            ...{ rows: [{ size: 'M', values: ['100.00', '73.00'] }] },
          },
        };
        assert.equal((await call('merchandising', next)).status, 200);
        const after = await view();
        assert.equal(after.current, true);
        assert.deepEqual(after.record!.submittedSnapshot, approved.record!.submittedSnapshot);
        assert.equal(after.preview.merchandising!.sizeGuide!.version, 1);
        assert.equal((await call('merchandising', { ...next, expectedVersion: 1 })).status, 409);
        assert.equal(
          (await call('merchandising', { ...next, expectedVersion: 2, slug: 'renamed-' + suffix }))
            .status,
          400,
        );
      },
    );
    await t.test(
      'retirement marks attached approval stale, blocks new assignments and preserves old snapshots',
      async () => {
        assert.equal(
          (
            await call('merchandising', {
              ...body(),
              expectedVersion: 2,
              definition: { ...body().definition, active: false },
            })
          ).status,
          200,
        );
        const v = await view();
        assert.equal(v.current, false);
        assert.ok(v.issues.some((x) => x.includes('retired')));
        assert.equal(v.record!.submittedSnapshot!.merchandising!.sizeGuide!.active, true);
        assert.equal(
          (
            await content('save', {
              merchandising: { sizeGuide: { id: guide, version: 1 }, collections: [] },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await content('save', {
              merchandising: { sizeGuide: null, collections: [{ id: collection, version: 1 }] },
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'an attached chart must cover every active SKU size before review submission',
      async () => {
        const id = randomUUID();
        created.add(id);
        assert.equal(
          (
            await call('merchandising', {
              ...body(id),
              slug: 'wrong-size-' + suffix,
              definition: {
                ...body().definition,
                ...{ rows: [{ size: 'L', values: ['100', '74'] }] },
              },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await content('save', {
              merchandising: { sizeGuide: { id, version: 1 }, collections: [] },
            })
          ).status,
          200,
        );
        assert.ok((await view()).issues.some((x) => x.includes('every active SKU size')));
        assert.equal((await content('submit')).status, 409);
        assert.equal(
          (
            await content('save', {
              merchandising: { sizeGuide: null, collections: [{ id: collection, version: 1 }] },
            })
          ).status,
          200,
        );
        assert.equal((await content('save')).status, 200);
        assert.equal((await view()).preview.merchandising!.collections.length, 1);
      },
    );
    await t.test(
      'different concurrent edit keys cannot overwrite one library revision',
      async () => {
        const id = randomUUID();
        created.add(id);
        const first = { ...body(id), slug: 'concurrent-' + suffix };
        assert.equal((await call('merchandising', first)).status, 200);
        const results = await Promise.all([
          call('merchandising', { ...first, expectedVersion: 1, reason: 'First competing edit' }),
          call('merchandising', { ...first, expectedVersion: 1, reason: 'Second competing edit' }),
        ]);
        assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
        const r = await (await call('merchandising/' + id)).json();
        assert.equal(r.item.version, 2);
        assert.equal(r.history.length, 2);
      },
    );
    await t.test(
      'search/pagination totals and fresh permissions are checked on cached library replays',
      async () => {
        for (let i = 0; i < 21; i++) {
          const id = randomUUID();
          created.add(id);
          assert.equal(
            (await call('merchandising', collectionBody(id, 'page-' + String(i).padStart(2, '0'))))
              .status,
            200,
          );
        }
        const page = await (await call('merchandising?kind=collection&page=2')).json();
        assert.equal(page.total, 23);
        assert.equal(page.items.length, 3);
        const literal = await (await call('merchandising?search=%25')).json();
        assert.equal(literal.total, 0);
        const id = randomUUID(),
          key = randomUUID();
        created.add(id);
        const input = collectionBody(id, 'revoked');
        assert.equal((await call('merchandising', input, 3, key)).status, 200);
        await db.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [users[3]]);
        assert.equal((await call('merchandising', input, 3, key)).status, 403);
      },
    );
    await t.test(
      'forward upgrade preserves old snapshots and empty schemas revert/reapply',
      async () => {
        const r = db.createQueryRunner();
        await r.connect();
        const schema = 'merch_scratch_' + suffix,
          migration = new CatalogMerchandising1794115000000();
        try {
          await r.startTransaction();
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET LOCAL search_path TO ' + schema + ',public');
          for (const prior of db.migrations) {
            if (prior instanceof CatalogMerchandising1794115000000) break;
            await prior.up(r);
          }
          await r.query(
            "INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,'OLD','Existing unchanged product','draft')",
            [product],
          );
          const before = await r.query('SELECT catalog_content_snapshot($1) AS snapshot', [
            product,
          ]);
          await migration.up(r);
          assert.deepEqual(
            await r.query('SELECT catalog_content_snapshot($1) AS snapshot', [product]),
            before,
          );
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 17);
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 16);
          await migration.up(r);
          assert.deepEqual(
            await r.query('SELECT catalog_content_snapshot($1) AS snapshot', [product]),
            before,
          );
          await r.rollbackTransaction();
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
      },
    );
    await t.test(
      'downgrade refuses to discard guide history or pinned product references',
      async () => {
        const r = db.createQueryRunner();
        await r.connect();
        try {
          await assert.rejects(new CatalogMerchandising1794115000000().down(r), /Cannot discard/);
        } finally {
          await r.release();
        }
      },
    );
  } finally {
    await app?.close();
    await runtime.destroy();
    await db.transaction(async (m) => {
      await m.query('DELETE FROM catalog_merch_requests WHERE actor_id=ANY($1::uuid[])', [users]);
      for (const table of [
        'catalog_content_requests',
        'catalog_content_events',
        'catalog_product_content',
        'catalog_merch_links',
        'catalog_media_requests',
      ])
        await m.query('DELETE FROM ' + table + ' WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_merch_versions WHERE item_id=ANY($1::uuid[])', [
        [...created],
      ]);
      await m.query('DELETE FROM catalog_merch_items WHERE id=ANY($1::uuid[])', [[...created]]);
      await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM catalog_product_photos WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_variants WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_products WHERE id=$1', [product]);
      await m.query('DELETE FROM catalog_categories WHERE id=$1', [category]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [roles]);
      await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [roles]);
      await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM locations WHERE id=$1', [scopedLocation]);
    });
    await db.destroy();
  }
});
