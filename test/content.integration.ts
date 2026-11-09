import { ContentIntegrity1794113000000 } from '../src/database/migrations/1794113000000-content-integrity.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import {
  createDataSource,
  createRuntimeDataSource,
  databaseUrl,
} from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { CatalogContent1794112000000 } from '../src/database/migrations/1794112000000-catalog-content.js';
import type { ContentInput, ContentView } from '../src/modules/catalog/content.types.js';
test('product content: typed preparation, protected review, stale approvals and immutable version history', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource();
  await db.initialize();
  const prefix = 'CONTENT' + randomBytes(4).toString('hex').toUpperCase(),
    users = Array.from({ length: 6 }, () => randomUUID()),
    roles = Array.from({ length: 5 }, () => randomUUID()),
    product = randomUUID(),
    variant = randomUUID(),
    category = randomUUID(),
    photo = randomUUID(),
    location = randomUUID(),
    requestIds: string[] = [],
    origin = 'http://content.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '',
    ready = false;
  const sessions: { cookie: string; csrf: string }[] = [];
  const names = users.map((_, i) => (prefix + i).toLowerCase());
  const buckets = [
    ...names.map((n) => tokenHash('user:' + n)),
    ...['ip:127.0.0.1', 'ip:::ffff:127.0.0.1'].map(tokenHash),
  ];
  const headers = (who = 0) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: sessions[who]!.cookie,
    'X-CSRF-Token': sessions[who]!.csrf,
  });
  async function call(body?: unknown, who = 0, key = randomUUID(), query = '') {
    const response = await fetch(
      base + '/api/v1/catalog/products/' + product + '/content' + query,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...headers(who), 'X-Idempotency-Key': key },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    requestIds.push(response.headers.get('x-request-id')!);
    return response;
  }
  async function view(): Promise<ContentView> {
    const r = await call();
    assert.equal(r.status, 200);
    return r.json();
  }
  const fields = () => ({
    profile: 'clothing-v1',
    slug: prefix.toLowerCase(),
    description: 'Soft cotton shirt for everyday wear.',
    specifications: {
      material: 'Cotton',
      care: 'Cold wash. Dry in shade.',
      fit: 'regular',
      garmentLengthCm: '72.50',
    },
  });
  async function body(action: ContentInput['action'], extra: Record<string, unknown> = {}) {
    const v = await view();
    return {
      action,
      expectedVersion: v.record?.version ?? 0,
      expectedProductVersion: v.productVersion,
      ...(action === 'save' ? fields() : {}),
      ...(['approve', 'request_changes', 'withdraw'].includes(action)
        ? { reason: 'Reviewed fixture decision' }
        : {}),
      ...extra,
    };
  }
  async function success(
    action: ContentInput['action'],
    who = 1,
    extra: Record<string, unknown> = {},
  ) {
    const r = await call(await body(action, extra), who);
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return r.json();
  }
  const rows = () =>
    db.query(
      `SELECT (SELECT to_jsonb(c) FROM catalog_product_content c WHERE product_id=$1) AS content,(SELECT count(*)::int FROM catalog_content_events WHERE product_id=$1) AS events,(SELECT count(*)::int FROM catalog_content_requests WHERE product_id=$1) AS requests`,
      [product],
    );
  try {
    await db.runMigrations();
    await grantRuntime(db, process.env);
    await runtime.initialize();
    ready = true;
    await db.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [buckets]);
    const hash = await new PasswordService().hash('Content integration password 2026!');
    for (let i = 0; i < users.length; i++)
      await db.query(
        'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,$3,$4,false)',
        [users[i], names[i], 'Content QA ' + i, hash],
      );
    await db.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [users[0]],
    );
    await db.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
      location,
      prefix,
      'Content scoped QA',
    ]);
    for (let i = 0; i < roles.length; i++) {
      await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [roles[i], prefix + i]);
      const permissions =
        i === 0
          ? ['catalog.read', 'catalog.content.manage']
          : i === 1
            ? ['catalog.read', 'catalog.content.review']
            : i === 2
              ? ['catalog.read']
              : ['catalog.read', 'catalog.content.manage', 'catalog.content.review'];
      for (const code of permissions)
        await db.query('INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)', [
          roles[i],
          code,
        ]);
      await db.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
        [users[i + 1], roles[i], i === 4 ? location : null],
      );
    }
    await db.query('INSERT INTO catalog_categories(id,name,name_key) VALUES($1,$2,$3)', [
      category,
      prefix,
      prefix.toLowerCase(),
    ]);
    await db.query(
      "INSERT INTO catalog_products(id,style_code,name,description,category_id,status) VALUES($1,$2,'Cotton QA shirt','Internal-only operational copy',$3,'active')",
      [product, prefix, category],
    );
    await db.query(
      'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,125010,\'{"size":"M","colour":"Black"}\')',
      [variant, product, prefix + '-M', 'c'.repeat(64)],
    );
    await db.query(
      'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash,is_primary) VALUES($1,$2,64,64,100,$3,true)',
      [photo, product, 'd'.repeat(64)],
    );
    app = await createApp({ ...process.env, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    for (const username of names) {
      const r = await fetch(base + '/api/v1/auth/login', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Requested-With': 'commerce-staff',
        },
        body: JSON.stringify({ username, password: 'Content integration password 2026!' }),
      });
      requestIds.push(r.headers.get('x-request-id')!);
      assert.equal(r.status, 200);
      sessions.push({
        cookie: r.headers.get('set-cookie')!.split(';')[0]!,
        csrf: (await r.json()).csrfToken,
      });
    }
    await t.test(
      'private read and independent content permissions protect staff previews and writes',
      async () => {
        assert.equal(
          (await fetch(base + '/api/v1/catalog/products/' + product + '/content')).status,
          401,
        );
        assert.equal((await call(undefined, 5)).status, 403);
        const v = await view();
        assert.equal(v.record, null);
        assert.equal(v.profiles.length, 3);
        assert.deepEqual(v.issues, ['Save product content first']);
        assert.equal((await call(await body('save'), 3)).status, 403);
        assert.equal((await call(await body('save'), 2)).status, 403);
        assert.equal((await call(await body('save'), 5)).status, 403);
        assert.equal((await call(undefined, 3, randomUUID(), '?page=0')).status, 400);
        const h = headers(1);
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        assert.equal(
          (
            await fetch(base + '/api/v1/catalog/products/' + product + '/content', {
              method: 'POST',
              headers: h,
              body: JSON.stringify(await body('save')),
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'draft saves accept incomplete content and preserve SKU options separately',
      async () => {
        await success('save', 1, { slug: '', description: '', specifications: {} });
        const v = await view();
        assert.equal(v.record!.state, 'draft');
        assert(v.issues.includes('Add Fabric / material'));
        assert(v.issues.includes('Add Fit'));
        assert.equal((await call(await body('submit'), 1)).status, 409);
        assert.deepEqual(v.preview.variants[0]!.attributes, { size: 'M', colour: 'Black' });
      },
    );
    await t.test(
      'SQL and HTTP reject unknown fields, invalid typed specifications and direct state writes',
      async () => {
        for (const patch of [
          { state: 'approved' },
          { specifications: { material: 'Cotton', privateCost: '123' } },
          { specifications: { fit: 'made_up' } },
          { specifications: { garmentLengthCm: '1e3' } },
          { specifications: { garmentLengthCm: '-2' } },
          { specifications: { material: 'x'.repeat(181) } },
        ])
          assert.equal((await call({ ...(await body('save')), ...patch }, 1)).status, 400);
        await assert.rejects(
          runtime.query("UPDATE catalog_product_content SET state='approved' WHERE false"),
          { code: '42501' },
        );
        await assert.rejects(runtime.query('DELETE FROM catalog_content_events WHERE false'), {
          code: '42501',
        });
        const bad = {
          ...(await body('save')),
          productId: product,
          specifications: { fit: 'invalid' },
        };
        await assert.rejects(
          runtime.query('SELECT catalog_content_post($1,$2,$3,$4::jsonb)', [
            randomUUID(),
            users[1],
            randomUUID(),
            JSON.stringify(bad),
          ]),
          /CONTENT_INVALID/,
        );
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege('public','public.catalog_content_post(uuid,uuid,uuid,jsonb)','EXECUTE') AS allowed",
            )
          )[0].allowed,
          false,
        );
      },
    );
    await t.test(
      'concurrent unchanged retries save once and changed actors/bodies cannot steal a key',
      async () => {
        const b = await body('save'),
          key = randomUUID(),
          before = (await rows())[0];
        const results = await Promise.all([call(b, 1, key), call(b, 1, key)]);
        assert.deepEqual(
          results.map((r) => r.status),
          [200, 200],
        );
        assert.deepEqual(await results[0]!.json(), await results[1]!.json());
        const after = (await rows())[0];
        assert.equal(after.events, before.events + 1);
        assert.equal(after.requests, before.requests + 1);
        assert.equal((await call({ ...b, description: 'Changed' }, 1, key)).status, 409);
        assert.equal((await call(b, 4, key)).status, 409);
        const cached = (
          await db.query('SELECT response FROM catalog_content_requests WHERE key=$1', [key])
        )[0].response;
        assert.deepEqual(Object.keys(cached).sort(), ['productId', 'state', 'version']);
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='catalog.content.manage'",
          [roles[0]],
        );
        try {
          assert.equal((await call(b, 1, key)).status, 403);
        } finally {
          await db.query(
            "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.content.manage')",
            [roles[0]],
          );
        }
      },
    );
    await t.test(
      'stale content revisions and concurrent different edits cannot overwrite a winner',
      async () => {
        const b = await body('save');
        const r = await Promise.all([
          call({ ...b, description: 'First edit' }, 1),
          call({ ...b, description: 'Second edit' }, 1),
        ]);
        assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
        await db.query('UPDATE catalog_products SET version=version+1 WHERE id=$1', [product]);
        assert.equal(
          (await call({ ...b, expectedVersion: (await view()).record!.version }, 1)).status,
          409,
        );
        await success('save');
      },
    );
    await t.test(
      'submitted copy is frozen, reviewers request changes and preparers cannot approve',
      async () => {
        await success('submit');
        let v = await view();
        assert.equal(v.record!.state, 'in_review');
        assert.equal(v.current, true);
        assert.equal((await call(await body('save'), 1)).status, 409);
        assert.equal((await call(await body('approve'), 1)).status, 403);
        assert.equal((await call(await body('approve', { reason: '' }), 2)).status, 400);
        await success('request_changes', 2, { reason: 'Clarify care instructions' });
        v = await view();
        assert.equal(v.record!.state, 'changes_requested');
        assert.equal(v.history.items[0]!.reason, 'Clarify care instructions');
      },
    );
    await t.test(
      'review approval keeps an immutable allowlisted copy without exposing operational description or originals',
      async () => {
        await success('save');
        await success('submit');
        await success('approve', 2);
        const v = await view();
        assert.equal(v.record!.state, 'approved');
        assert.equal(v.current, true);
        assert.equal(v.record!.submittedSnapshot!.variants[0]!.priceMinor, '125010');
        assert(!JSON.stringify(v.preview).includes('Internal-only'));
        assert(!JSON.stringify(v.preview).includes('original'));
        assert(!JSON.stringify(v.preview).includes('storage'));
        const saved = v.history.items.find((e) => e.action === 'approve')!;
        assert.equal(saved.snapshot.description, fields().description);
        assert.equal((await call(await body('save'), 2)).status, 403);
      },
    );
    await t.test(
      'database constraints reject partial review snapshots and missing submitters',
      async () => {
        await assert.rejects(
          db.query('UPDATE catalog_product_content SET fingerprint=NULL WHERE product_id=$1', [
            product,
          ]),
          { code: '23514' },
        );
        await assert.rejects(
          db.query(
            'UPDATE catalog_product_content SET submitted_snapshot=NULL WHERE product_id=$1',
            [product],
          ),
          { code: '23514' },
        );
        await assert.rejects(
          db.query('UPDATE catalog_product_content SET submitted_by=NULL WHERE product_id=$1', [
            product,
          ]),
          { code: '23514' },
        );
        const refusal = db.createQueryRunner();
        await refusal.connect();
        try {
          await assert.rejects(new ContentIntegrity1794113000000().down(refusal), /Cannot weaken/);
        } finally {
          await refusal.release();
        }
      },
    );
    await t.test(
      'catalog and price changes invalidate approval, including writes without a product version bump',
      async () => {
        await db.query('UPDATE catalog_variants SET price_minor=125011 WHERE id=$1', [variant]);
        let v = await view();
        assert.equal(v.current, false);
        assert.equal(v.record!.state, 'approved');
        assert.equal(v.record!.submittedSnapshot!.variants[0]!.priceMinor, '125010');
        await success('save');
        await success('submit');
        await db.query("UPDATE catalog_categories SET name=name||' revised' WHERE id=$1", [
          category,
        ]);
        assert.equal((await call(await body('approve'), 2)).status, 409);
        await success('request_changes', 2);
        await success('save');
        await success('submit');
        await db.query('UPDATE catalog_product_photos SET content_hash=$1 WHERE id=$2', [
          'e'.repeat(64),
          photo,
        ]);
        v = await view();
        assert.equal(v.current, false);
        assert.equal((await call(await body('approve'), 2)).status, 409);
        await success('withdraw', 1, { reason: 'Refresh the changed photo' });
      },
    );
    await t.test(
      'ordinary staff cannot self-approve; owner self-approval is explicit and audited',
      async () => {
        await success('save', 4);
        await success('submit', 4);
        const r = await call(await body('approve'), 4);
        assert.equal(r.status, 409);
        assert.equal((await r.json()).code, 'CONTENT_SELF_REVIEW');
        await success('request_changes', 2);
        await success('save', 0);
        await success('submit', 0);
        await success('approve', 0, { reason: 'Owner reviewed the catalog and photos' });
        assert.equal(
          (
            await db.query(
              "SELECT metadata->>'ownerSelfReview' AS self FROM audit_events WHERE actor_id=$1 AND action='catalog.content_approve' ORDER BY created_at DESC LIMIT 1",
              [users[0]],
            )
          )[0].self,
          'true',
        );
      },
    );
    await t.test(
      'audit failure rolls back content, history and retry key before a safe same-key retry',
      async () => {
        for (const action of ['save', 'submit', 'approve'] as const) {
          const b = await body(action),
            who = action === 'approve' ? 2 : 1,
            key = randomUUID(),
            before = await rows(),
            name = 'content_fail_' + prefix.toLowerCase();
          await db.query(
            `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action LIKE 'catalog.content_%' THEN RAISE EXCEPTION 'Intentional content audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
          );
          try {
            const r = await call(b, who, key);
            assert.equal(r.status, 500);
            assert(!JSON.stringify(await r.json()).includes('Intentional'));
            assert.deepEqual(await rows(), before);
          } finally {
            await db.query(
              'DROP TRIGGER ' + name + ' ON audit_events;DROP FUNCTION ' + name + '()',
            );
          }
          assert.equal((await call(b, who, key)).status, 200);
        }
      },
    );
    await t.test(
      'withdrawal preserves review history and review permission revocation blocks cached approval replay',
      async () => {
        await success('save');
        await success('submit');
        assert.equal((await call(await body('withdraw'), 2)).status, 403);
        await success('withdraw', 1, { reason: 'Correct before approval' });
        await success('save');
        await success('submit');
        const b = await body('approve'),
          key = randomUUID();
        assert.equal((await call(b, 2, key)).status, 200);
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='catalog.content.review'",
          [roles[1]],
        );
        try {
          assert.equal((await call(b, 2, key)).status, 403);
        } finally {
          await db.query(
            "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.content.review')",
            [roles[1]],
          );
        }
        const history = await call(undefined, 0, randomUUID(), '?page=2');
        assert.equal(history.status, 200);
        assert((await history.json()).history.items.length > 0);
      },
    );
    await t.test(
      'compiled migration refuses history loss and safely upgrades, reverts and reapplies empty content',
      async () => {
        const next = new CatalogContent1794112000000();
        const refusalRunner = db.createQueryRunner();
        await refusalRunner.connect();
        try {
          await assert.rejects(next.down(refusalRunner), /Cannot discard/);
        } finally {
          await refusalRunner.release();
        }
        const r = db.createQueryRunner(),
          schema = 'content_scratch_' + prefix.toLowerCase();
        await r.connect();
        try {
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET search_path TO ' + schema + ',public');
          for (const migration of db.migrations) {
            if (migration instanceof CatalogContent1794112000000) break;
            await migration.up(r);
          }
          await r.query(
            "INSERT INTO catalog_products(style_code,name,status) VALUES('UNCHANGED','Existing catalog','draft')",
          );
          const before = await r.query('SELECT to_jsonb(p) AS product FROM catalog_products p');
          await next.up(r);
          assert.deepEqual(
            await r.query('SELECT to_jsonb(p) AS product FROM catalog_products p'),
            before,
          );
          assert.equal(
            (await r.query('SELECT count(*)::int AS n FROM catalog_content_profiles'))[0].n,
            3,
          );
          await next.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 13);
          await next.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 14);
          const integrity = new ContentIntegrity1794113000000();
          await integrity.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 15);
          await integrity.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 14);
          await integrity.up(r);
        } finally {
          await r.query('SET search_path TO public');
          await r.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
          await r.release();
        }
      },
    );
  } finally {
    if (app) await app.close();
    if (runtime.isInitialized) await runtime.destroy();
    if (ready)
      await db.transaction(async (m) => {
        for (const table of [
          'catalog_content_requests',
          'catalog_content_events',
          'catalog_product_content',
        ])
          await m.query('DELETE FROM ' + table + ' WHERE product_id=$1', [product]);
        await m.query(
          'DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[]) OR request_id=ANY($2::uuid[])',
          [users, requestIds.filter(Boolean)],
        );
        await m.query('DELETE FROM catalog_product_photos WHERE product_id=$1', [product]);
        await m.query('DELETE FROM catalog_variants WHERE product_id=$1', [product]);
        await m.query('DELETE FROM catalog_products WHERE id=$1', [product]);
        await m.query('DELETE FROM catalog_categories WHERE id=$1', [category]);
        await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [roles]);
        await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [roles]);
        await m.query('DELETE FROM locations WHERE id=$1', [location]);
        await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
        await m.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [buckets]);
      });
    await db.destroy();
  }
});
