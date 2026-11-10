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
import { CatalogPresentation1794116000000 } from '../src/database/migrations/1794116000000-catalog-presentation.js';
import type { TaxonomyInput } from '../src/modules/catalog/presentation.types.js';
import type { ContentView } from '../src/modules/catalog/content.types.js';
test('category presentation: protected graph, reserved routes, SEO snapshots and atomic review', async (t) => {
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
    roles = [randomUUID(), randomUUID()],
    tokens = users.map(() => randomBytes(32).toString('base64url')),
    csrf = users.map(() => randomBytes(32).toString('hex')),
    location = randomUUID(),
    root = randomUUID(),
    child = randomUUID(),
    other = randomUUID(),
    product = randomUUID(),
    variant = randomUUID(),
    photo = randomUUID(),
    categories = new Set([root, child, other]),
    extraProducts = new Set<string>(),
    keys = new Set<string>(),
    origin = 'http://presentation.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '';
  const headers = (who = 0) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: 'commerce_session=' + tokens[who],
    'X-CSRF-Token': csrf[who]!,
  });
  async function call(path: string, body?: unknown, who = 0, key = randomUUID()) {
    keys.add(key);
    return fetch(base + '/api/v1/catalog/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers(who), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const body = (id = root): TaxonomyInput => ({
    id,
    expectedVersion: 0,
    name: 'Category ' + id.slice(0, 8),
    parentId: null,
    active: true,
    slug: 'category-' + id.slice(0, 8),
    seo: { title: 'Category title', description: 'A clear category description.' },
    reason: 'Prepare category navigation',
  });
  const contentPath = 'products/' + product + '/content';
  async function view() {
    const r = await call(contentPath);
    assert.equal(r.status, 200);
    return r.json() as Promise<ContentView>;
  }
  const fields = {
    profile: 'clothing-v1',
    slug: 'presentation-product-' + suffix,
    description: 'A comfortable cotton shirt.',
    specifications: { material: 'Cotton', care: 'Gentle wash', fit: 'regular' },
  };
  async function content(action: string, extra: Record<string, unknown> = {}, key = randomUUID()) {
    const v = await view();
    return call(
      contentPath,
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
      for (let i = 0; i < 4; i++) {
        await m.query(
          "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Presentation test staff','not-a-login-hash',false)",
          [users[i], 'presentation.test.' + suffix + i],
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
      for (let i = 0; i < 2; i++)
        await m.query('INSERT INTO roles(id,code) VALUES($1,$2)', [
          roles[i],
          'presentation_' + suffix + i,
        ]);
      await m.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.read'),($1,'catalog.manage'),($1,'catalog.content.manage'),($2,'catalog.taxonomy.manage')",
        roles,
      );
      await m.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
        location,
        'PRESENT' + suffix.toUpperCase(),
        'Scoped test location',
      ]);
      await m.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2),($3,$2)', [
        users[1],
        roles[0],
        users[2],
      ]);
      await m.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
        [users[2], roles[1], location],
      );
      await m.query('INSERT INTO catalog_categories(id,name,name_key) VALUES($1,$2,$3)', [
        root,
        'Legacy root ' + suffix,
        'legacy root ' + suffix,
      ]);
      await m.query(
        'INSERT INTO catalog_categories(id,name,name_key,parent_id) VALUES($1,$2,$3,$4)',
        [child, 'Legacy child ' + suffix, 'legacy child ' + suffix, root],
      );
      await m.query(
        "INSERT INTO catalog_products(id,style_code,name,category_id,status) VALUES($1,$2,'Presentation shirt',$3,'active')",
        [product, 'PRESENT' + suffix.toUpperCase(), child],
      );
      await m.query(
        'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,129000,\'{"size":"M"}\')',
        [variant, product, 'PRESENT-' + suffix.toUpperCase(), 'b'.repeat(64)],
      );
      await m.query(
        'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash,is_primary) VALUES($1,$2,64,64,100,$3,true)',
        [photo, product, 'c'.repeat(64)],
      );
    });
    app = await createApp({ ...process.env, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    await t.test(
      'taxonomy read/write, global scope and CSRF protections remain independent',
      async () => {
        assert.equal((await fetch(base + '/api/v1/catalog/taxonomy')).status, 401);
        assert.equal((await call('taxonomy', undefined, 1)).status, 200);
        assert.equal((await call('taxonomy', body(), 1)).status, 403);
        assert.equal((await call('taxonomy', body(), 2)).status, 403);
        const h = headers();
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        assert.equal(
          (
            await fetch(base + '/api/v1/catalog/taxonomy', {
              method: 'POST',
              headers: h,
              body: JSON.stringify(body()),
            })
          ).status,
          403,
        );
        await assert.rejects(
          runtime.query('UPDATE catalog_categories SET name=name WHERE id=$1', [root]),
          (e) =>
            !!e &&
            typeof e === 'object' &&
            'driverError' in e &&
            (e.driverError as { code: string }).code === '42501',
        );
        await assert.rejects(
          runtime.query('SELECT catalog_category_post($1,$2,$3,$4::jsonb)', [
            randomUUID(),
            users[2],
            randomUUID(),
            JSON.stringify(body()),
          ]),
          /CONTENT_PERMISSION/,
        );
      },
    );
    await t.test(
      'existing operational categories remain identifiable without invented SEO data',
      async () => {
        const r = await (await call('taxonomy/' + root)).json();
        assert.equal(r.item.version, 0);
        assert.equal(r.item.slug, null);
        assert.equal(r.item.name, 'Legacy root ' + suffix);
        const v = await view();
        assert.equal(v.preparation.checks.find((x) => x.code === 'category_urls')!.passed, false);
        assert.equal(v.preview.seo, undefined);
      },
    );
    await t.test(
      'concurrent retry keys record one category revision and reject changed actors or bodies',
      async () => {
        const key = randomUUID(),
          input = body();
        const r = await Promise.all([
          call('taxonomy', input, 0, key),
          call('taxonomy', input, 0, key),
        ]);
        assert.deepEqual(
          r.map((x) => x.status),
          [200, 200],
        );
        assert.deepEqual(await r[0]!.json(), await r[1]!.json());
        assert.equal((await call('taxonomy', { ...input, reason: 'Changed' }, 0, key)).status, 409);
        assert.equal((await call('taxonomy', input, 3, key)).status, 409);
        const row = await (await call('taxonomy/' + root)).json();
        assert.equal(row.history.length, 1);
        assert.equal(row.history[0].before.name, 'Legacy root ' + suffix);
      },
    );
    await t.test(
      'URL changes preserve direct ownership of old names and forbid takeover or clearing',
      async () => {
        const next = { ...body(), expectedVersion: 1, slug: 'renamed-' + suffix };
        assert.equal((await call('taxonomy', next)).status, 200);
        const row = await (await call('taxonomy/' + root)).json();
        assert.deepEqual(row.routes.sort(), [body().slug, next.slug].sort());
        assert.equal((await call('taxonomy', { ...body(other), slug: body().slug })).status, 409);
        assert.equal(
          (
            await db.query('SELECT count(*)::int AS n FROM catalog_categories WHERE id=$1', [other])
          )[0].n,
          0,
        );
        assert.equal(
          (await call('taxonomy', { ...next, expectedVersion: 2, slug: '' })).status,
          400,
        );
      },
    );
    await t.test(
      'category hierarchy blocks cycles, self-parenting and unsafe retirement',
      async () => {
        const rootInput = {
          ...body(),
          expectedVersion: 2,
          slug: 'renamed-' + suffix,
          parentId: child,
        };
        assert.equal((await call('taxonomy', rootInput)).status, 400);
        assert.equal((await call('taxonomy', { ...rootInput, parentId: root })).status, 400);
        assert.equal(
          (await call('taxonomy', { ...body(child), parentId: root, active: false })).status,
          409,
        );
        assert.equal(
          (
            await call('taxonomy', {
              ...body(),
              expectedVersion: 2,
              slug: 'renamed-' + suffix,
              active: false,
            })
          ).status,
          400,
        );
        const bad = randomUUID();
        await assert.rejects(
          runtime.query(
            'INSERT INTO catalog_categories(id,name,name_key,parent_id) VALUES($1,$2,$3,$1)',
            [bad, 'Bad cycle', 'bad cycle ' + suffix],
          ),
          /TAXONOMY_GRAPH/,
        );
      },
    );
    await t.test(
      'parent metadata makes preparation complete without editing products or releasing media',
      async () => {
        assert.equal((await call('taxonomy', { ...body(child), parentId: root })).status, 200);
        const v = await view();
        assert.equal(v.preparation.checks.find((x) => x.code === 'category_urls')!.passed, true);
        assert.deepEqual(
          v.preparation.categoryPath.map((x) => x.id),
          [root, child],
        );
        assert.equal(
          v.preparation.checks.find((x) => x.code === 'content_approval')!.passed,
          false,
        );
        assert.equal((await fetch(base + '/api/v1/public/products')).status, 404);
      },
    );
    await t.test(
      'category audit failure rolls back names, routes, history and retries before a safe retry',
      async () => {
        const id = randomUUID();
        categories.add(id);
        const input = body(id),
          key = randomUUID(),
          fn = 'presentation_audit_' + suffix;
        await db.query(
          `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.actor_id='${users[0]}'::uuid AND NEW.action='catalog.category_saved' THEN RAISE EXCEPTION 'forced category audit failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
        );
        try {
          assert.equal((await call('taxonomy', input, 0, key)).status, 500);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM catalog_categories WHERE id=$1', [id])
            )[0].n,
            0,
          );
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM catalog_category_routes WHERE category_id=$1',
                [id],
              )
            )[0].n,
            0,
          );
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM catalog_presentation_requests WHERE key=$1',
                [key],
              )
            )[0].n,
            0,
          );
        } finally {
          await db.query(`DROP TRIGGER ${fn} ON audit_events;DROP FUNCTION ${fn}()`);
        }
        assert.equal((await call('taxonomy', input, 0, key)).status, 200);
      },
    );
    await t.test(
      'product SEO is saved and reviewed atomically while older clients preserve overrides',
      async () => {
        assert.equal((await content('save')).status, 200);
        assert.equal((await view()).preview.seo, undefined);
        const v = await view(),
          key = randomUUID(),
          input = {
            action: 'save',
            ...fields,
            expectedVersion: v.record!.version,
            expectedProductVersion: v.productVersion,
            seo: {
              title: 'Cotton shirt | Search title',
              description: 'A concise product summary.',
            },
          };
        assert.equal((await call(contentPath, input, 0, key)).status, 200);
        assert.equal((await call(contentPath, input, 0, key)).status, 200);
        assert.equal(
          (
            await call(
              contentPath,
              { ...input, seo: { title: 'Changed', description: '' } },
              0,
              key,
            )
          ).status,
          409,
        );
        assert.equal((await view()).preview.seo!.title, input.seo.title);
        assert.equal((await content('save')).status, 200);
        assert.equal((await view()).preview.seo!.title, input.seo.title);
        assert.equal((await content('submit')).status, 200);
        assert.equal(
          (await content('save', { seo: { title: 'Frozen change', description: '' } })).status,
          409,
        );
        assert.equal(
          (await content('approve', { reason: 'Owner checked SEO and product content' })).status,
          200,
        );
        const approved = await view();
        assert.equal(
          approved.preparation.checks.find((x) => x.code === 'content_approval')!.passed,
          true,
        );
        assert.equal(approved.record!.submittedSnapshot!.seo!.description, input.seo.description);
      },
    );
    await t.test(
      'SEO audit failure restores the old copy and retry state before reuse',
      async () => {
        const before = await view(),
          key = randomUUID(),
          fn = 'seo_audit_' + suffix,
          input = {
            action: 'save',
            ...fields,
            expectedVersion: before.record!.version,
            expectedProductVersion: before.productVersion,
            seo: { title: 'Rollback candidate', description: 'Must not partially save' },
          };
        await db.query(
          `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.actor_id='${users[0]}'::uuid AND NEW.action='catalog.content_save' THEN RAISE EXCEPTION 'forced SEO audit failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
        );
        try {
          assert.equal((await call(contentPath, input, 0, key)).status, 500);
          const after = await view();
          assert.equal(after.record!.version, before.record!.version);
          assert.deepEqual(after.preview.seo, before.preview.seo);
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM catalog_presentation_requests WHERE key=$1',
                [key],
              )
            )[0].n,
            0,
          );
        } finally {
          await db.query(`DROP TRIGGER ${fn} ON audit_events;DROP FUNCTION ${fn}()`);
        }
        // A successful retry is followed by review so subsequent tests still inspect an approved copy.
        assert.equal((await call(contentPath, input, 0, key)).status, 200);
        assert.equal((await content('submit')).status, 200);
        assert.equal(
          (await content('approve', { reason: 'Owner checked retried SEO copy' })).status,
          200,
        );
      },
    );
    await t.test(
      'category SEO revisions do not rewrite product approval; category renames invalidate current copies',
      async () => {
        const v = await view(),
          row = await (await call('taxonomy/' + child)).json();
        const input = {
          ...body(child),
          expectedVersion: row.item.version,
          parentId: root,
          name: row.item.name,
          seo: { title: 'Better category title', description: 'Updated category summary' },
        };
        assert.equal((await call('taxonomy', input)).status, 200);
        assert.equal((await view()).current, true);
        assert.deepEqual((await view()).record!.submittedSnapshot, v.record!.submittedSnapshot);
        assert.equal(
          (
            await call('taxonomy', {
              ...input,
              expectedVersion: input.expectedVersion + 1,
              name: 'Renamed child ' + suffix,
            })
          ).status,
          200,
        );
        assert.equal((await view()).current, false);
      },
    );
    await t.test(
      'different edit keys serialize against one revision and sibling names stay unique',
      async () => {
        const row = await (await call('taxonomy/' + root)).json();
        const input = { ...body(), expectedVersion: row.item.version, slug: row.item.slug };
        const replies = await Promise.all([
          call('taxonomy', { ...input, reason: 'First competing edit' }),
          call('taxonomy', { ...input, reason: 'Second competing edit' }),
        ]);
        assert.deepEqual(replies.map((x) => x.status).sort(), [200, 409]);
        const id = randomUUID();
        categories.add(id);
        assert.equal((await call('taxonomy', { ...body(id), name: row.item.name })).status, 409);
      },
    );
    await t.test(
      'restricted category locks prevent retirement racing an active product insertion',
      async () => {
        const id = randomUUID(),
          extra = randomUUID();
        categories.add(id);
        extraProducts.add(extra);
        const input = body(id);
        assert.equal((await call('taxonomy', input)).status, 200);
        const r = runtime.createQueryRunner();
        await r.connect();
        let retiring: Promise<Response> | undefined;
        try {
          await r.startTransaction();
          assert.equal(
            (await r.query('SELECT catalog_category_active($1) AS valid', [id]))[0].valid,
            true,
          );
          let settled = false;
          retiring = call('taxonomy', { ...input, expectedVersion: 1, active: false }).then(
            (response) => {
              settled = true;
              return response;
            },
          );
          await new Promise((resolve) => setTimeout(resolve, 80));
          assert.equal(settled, false);
          await r.query(
            "INSERT INTO catalog_products(id,style_code,name,category_id,status) VALUES($1,$2,'Concurrent active product',$3,'active')",
            [extra, 'LOCK' + suffix.toUpperCase(), id],
          );
          await r.commitTransaction();
          assert.equal((await retiring).status, 409);
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
          if (retiring) await retiring;
        }
      },
    );
    await t.test(
      'legacy category insertion also enforces the twelve-level hierarchy boundary',
      async () => {
        let parent: string | null = null;
        for (let i = 0; i < 12; i++) {
          const id = randomUUID();
          categories.add(id);
          await runtime.query(
            'INSERT INTO catalog_categories(id,name,name_key,parent_id) VALUES($1,$2,$3,$4)',
            [id, 'Depth ' + i, 'depth ' + suffix + ' ' + i, parent],
          );
          parent = id;
        }
        const id = randomUUID();
        categories.add(id);
        await assert.rejects(
          runtime.query(
            'INSERT INTO catalog_categories(id,name,name_key,parent_id) VALUES($1,$2,$3,$4)',
            [id, 'Too deep', 'too deep ' + suffix, parent],
          ),
          /TAXONOMY_GRAPH/,
        );
      },
    );
    await t.test(
      'literal search, read limits and live permission revocation protect cached category actions',
      async () => {
        const data = await (await call('taxonomy?search=%25')).json();
        assert.equal(data.total, 0);
        assert.equal((await call('taxonomy?status=public')).status, 400);
        const id = randomUUID();
        categories.add(id);
        const key = randomUUID(),
          input = body(id);
        assert.equal((await call('taxonomy', input, 3, key)).status, 200);
        await db.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [users[3]]);
        assert.equal((await call('taxonomy', input, 3, key)).status, 403);
      },
    );
    await t.test(
      'the additive migration preserves old snapshots and refuses dropping retained SEO history',
      async () => {
        const r = db.createQueryRunner();
        await r.connect();
        const migration = new CatalogPresentation1794116000000();
        try {
          await assert.rejects(migration.down(r), /Cannot discard/);
          await r.startTransaction();
          const schema = 'presentation_scratch_' + suffix;
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET LOCAL search_path TO ' + schema + ',public');
          for (const prior of db.migrations) {
            if (prior instanceof CatalogPresentation1794116000000) break;
            await prior.up(r);
          }
          await r.query(
            "INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,'UNCHANGED','Existing product','draft')",
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
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 17);
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
  } finally {
    await app?.close();
    await runtime.destroy();
    await db.transaction(async (m) => {
      await m.query('DELETE FROM catalog_presentation_requests WHERE actor_id=ANY($1::uuid[])', [
        users,
      ]);
      await m.query('DELETE FROM catalog_product_seo WHERE product_id=$1', [product]);
      for (const table of [
        'catalog_content_requests',
        'catalog_content_events',
        'catalog_product_content',
        'catalog_merch_links',
        'catalog_media_requests',
      ])
        await m.query('DELETE FROM ' + table + ' WHERE product_id=$1', [product]);
      await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM catalog_product_photos WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_variants WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_products WHERE id=$1', [product]);
      await m.query('DELETE FROM catalog_products WHERE id=ANY($1::uuid[])', [[...extraProducts]]);
      await m.query('DELETE FROM catalog_category_events WHERE category_id=ANY($1::uuid[])', [
        [...categories],
      ]);
      await m.query('DELETE FROM catalog_category_presentation WHERE category_id=ANY($1::uuid[])', [
        [...categories],
      ]);
      await m.query('DELETE FROM catalog_category_routes WHERE category_id=ANY($1::uuid[])', [
        [...categories],
      ]);
      await m.query('DELETE FROM catalog_categories WHERE id=$1', [child]);
      await m.query('DELETE FROM catalog_categories WHERE id=ANY($1::uuid[])', [
        [...categories].filter((x) => x !== child),
      ]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [roles]);
      await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [roles]);
      await m.query('DELETE FROM locations WHERE id=$1', [location]);
      await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
    });
    await db.destroy();
  }
});
