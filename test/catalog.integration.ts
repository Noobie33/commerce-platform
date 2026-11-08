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
import { IdentityFoundation1794096000000 } from '../src/database/migrations/1794096000000-identity-foundation.js';
import { CatalogFoundation1794100000000 } from '../src/database/migrations/1794100000000-catalog-foundation.js';
import type { Product } from '../src/modules/catalog/catalog.types.js';

test('catalog: actual HTTP permissions, exact prices, safe retries and edit concurrency', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const source = createDataSource();
  await source.initialize();
  const prefix = 'CAT' + randomBytes(5).toString('hex').toUpperCase();
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const names = users.map((_, i) => (prefix + '_' + i).toLowerCase());
  const roles = [randomUUID(), randomUUID()],
    location = randomUUID();
  const categories: string[] = [],
    styles: string[] = [],
    requests: string[] = [];
  const ipBuckets = ['ip:127.0.0.1', 'ip:::ffff:127.0.0.1'].map(tokenHash);
  const buckets = [...ipBuckets, ...names.map((name) => tokenHash('user:' + name))];
  const password = 'Catalog integration password 2026!';
  const origin = 'http://catalog.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let base = '',
    schemaReady = false;
  type Session = { cookie: string; csrf: string };
  const auth = (s: Session) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: s.cookie,
    'X-CSRF-Token': s.csrf,
  });
  async function call(
    path: string,
    session?: Session,
    body?: unknown,
    key?: string,
    method?: string,
  ) {
    const response = await fetch(base + '/api/v1' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(session ? auth(session) : {}), ...(key ? { 'X-Idempotency-Key': key } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const requestId = response.headers.get('x-request-id');
    if (requestId) requests.push(requestId);
    return response;
  }
  function payload(suffix: string, sku?: string) {
    const styleCode = prefix + '-' + suffix;
    styles.push(styleCode);
    return {
      styleCode,
      name: 'Cotton ' + suffix,
      description: 'Test fixture',
      categoryId: categories[0] ?? null,
      status: 'active',
      currency: 'BDT',
      variants: [
        {
          sku: sku ?? styleCode + '-M',
          attributes: { size: 'M', colour: 'Black' },
          barcode: null as string | null,
          price: '1250.10',
          isActive: true,
        },
      ],
    };
  }
  function edit(product: Product) {
    const variants: (Omit<Product['variants'][number], 'id'> & { id?: string })[] =
      product.variants.map((row) => ({ ...row }));
    return {
      styleCode: product.styleCode,
      name: product.name,
      description: product.description,
      categoryId: product.categoryId,
      status: product.status,
      currency: product.currency,
      expectedVersion: product.version,
      variants,
    };
  }
  try {
    await source.runMigrations();
    await grantRuntime(source, process.env);
    schemaReady = true;
    await source.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
      buckets,
    ]);
    const hash = await new PasswordService().hash(password);
    await source.transaction(async (m) => {
      for (let i = 0; i < 4; i++)
        await m.query(
          'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES ($1,$2,$3,$4,false)',
          [users[i], names[i], 'Catalog fixture', hash],
        );
      await m.query('INSERT INTO locations(id,code,name) VALUES ($1,$2,$3)', [
        location,
        prefix,
        'Catalog test location',
      ]);
      for (const id of [users[0], users[3]])
        await m.query(
          "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
          [id],
        );
      await m.query('INSERT INTO roles(id,code) VALUES ($1,$2),($3,$4)', [
        roles[0],
        prefix + '_read',
        roles[1],
        prefix + '_scoped',
      ]);
      await m.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES ($1,'catalog.read'),($2,'catalog.read'),($2,'catalog.manage')",
        [roles[0], roles[1]],
      );
      await m.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES ($1,$2,NULL),($3,$4,$5)',
        [users[1], roles[0], users[2], roles[1], location],
      );
    });
    app = await createApp({ ...process.env, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const sessions: Session[] = [];
    for (const username of names) {
      const r = await fetch(base + '/api/v1/auth/login', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Requested-With': 'commerce-staff',
        },
        body: JSON.stringify({ username, password }),
      });
      const id = r.headers.get('x-request-id');
      if (id) requests.push(id);
      assert.equal(r.status, 200);
      const b = await r.json();
      sessions.push({ cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: b.csrfToken });
    }
    const owner = sessions[0]!,
      reader = sessions[1]!,
      scoped = sessions[2]!,
      peer = sessions[3]!;
    let saved: Product;

    await t.test(
      'catalog requires global action permission and CSRF; category names are data',
      async () => {
        assert.equal((await call('/catalog/products')).status, 401);
        assert.equal((await call('/catalog/products', scoped)).status, 403);
        assert.equal((await call('/catalog/products', reader)).status, 200);
        assert.equal(
          (await call('/catalog/categories', reader, { name: prefix, parentId: null })).status,
          403,
        );
        const r = await call('/catalog/categories', owner, { name: prefix, parentId: null });
        assert.equal(r.status, 201);
        const category = await r.json();
        categories.push(category.id);
        const child = await call('/catalog/categories', owner, {
          name: 'শিশুদের পোশাক',
          parentId: category.id,
        });
        assert.equal(child.status, 201);
        categories.push((await child.json()).id);
        const duplicate = await call('/catalog/categories', owner, {
          name: prefix.toLowerCase(),
          parentId: null,
        });
        assert.equal(duplicate.status, 409);
        const p = payload('NO-CSRF');
        const denied = await fetch(base + '/api/v1/catalog/products', {
          method: 'POST',
          headers: { ...auth(owner), 'X-CSRF-Token': 'bad', 'X-Idempotency-Key': randomUUID() },
          body: JSON.stringify(p),
        });
        assert.equal(denied.status, 403);
      },
    );

    await t.test(
      'concurrent identical saves create one product, one audit and an exact price',
      async () => {
        const body = payload('RETRY'),
          key = randomUUID();
        const results = await Promise.all([
          call('/catalog/products', owner, body, key),
          call('/catalog/products', owner, body, key),
        ]);
        assert.deepEqual(
          results.map((r) => r.status),
          [201, 201],
        );
        const first: Product = await results[0]!.json(),
          second = await results[1]!.json();
        assert.deepEqual(first, second);
        saved = first;
        assert.equal(first.variants[0]!.price, '1250.10');
        assert.equal(
          (
            await source.query(
              'SELECT price_minor::text AS price FROM catalog_variants WHERE product_id=$1',
              [first.id],
            )
          )[0].price,
          '125010',
        );
        assert.equal(
          (
            await source.query(
              "SELECT count(*)::int AS total FROM audit_events WHERE action='catalog.product_created' AND metadata->>'entityId'=$1",
              [first.id],
            )
          )[0].total,
          1,
        );
        assert.equal(
          (await call('/catalog/products', owner, { ...body, name: 'different' }, key)).status,
          409,
        );
        assert.equal((await call('/catalog/products', peer, body, key)).status, 409);
      },
    );

    await t.test(
      'concurrent edits detect stale versions instead of overwriting each other',
      async () => {
        const a = { ...edit(saved), name: 'Change A' },
          b = { ...edit(saved), name: 'Change B' };
        const responses = await Promise.all([
          call('/catalog/products/' + saved.id, owner, a, randomUUID(), 'PATCH'),
          call('/catalog/products/' + saved.id, peer, b, randomUUID(), 'PATCH'),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const result: Product = await (await call('/catalog/products/' + saved.id, owner)).json();
        assert.equal(result.version, 2);
        assert.ok(['Change A', 'Change B'].includes(result.name));
        saved = result;
      },
    );

    await t.test(
      'SKU collisions/barcode collisions roll back the entire competing product',
      async () => {
        const shared = prefix + '-SHARED',
          a = payload('UNIQUE-A', shared),
          b = payload('UNIQUE-B', shared);
        const r = await Promise.all([
          call('/catalog/products', owner, a, randomUUID()),
          call('/catalog/products', peer, b, randomUUID()),
        ]);
        assert.deepEqual(r.map((v) => v.status).sort(), [201, 409]);
        const barcode = prefix + '-BARCODE';
        const first = payload('BARCODE-A');
        first.variants[0]!.barcode = barcode;
        assert.equal((await call('/catalog/products', owner, first, randomUUID())).status, 201);
        const second = payload('BARCODE-B');
        second.variants[0]!.barcode = barcode;
        assert.equal((await call('/catalog/products', owner, second, randomUUID())).status, 409);
        assert.equal(
          (
            await source.query(
              'SELECT count(*)::int AS total FROM catalog_products WHERE style_code=$1',
              [second.styleCode],
            )
          )[0].total,
          0,
        );
      },
    );

    await t.test(
      'saved identifiers cannot be renamed; deactivation/replacement preserves history',
      async () => {
        const rename = edit(saved);
        rename.variants[0]!.sku = prefix + '-RENAMED';
        assert.equal(
          (await call('/catalog/products/' + saved.id, owner, rename, randomUUID(), 'PATCH'))
            .status,
          400,
        );
        const next = edit(saved);
        next.variants[0]!.isActive = false;
        next.variants.push({
          sku: prefix + '-REPLACEMENT',
          attributes: { size: 'M', colour: 'Black' },
          barcode: null,
          price: '1499.99',
          isActive: true,
        });
        const response = await call(
          '/catalog/products/' + saved.id,
          owner,
          next,
          randomUUID(),
          'PATCH',
        );
        assert.equal(response.status, 200);
        const result: Product = await response.json();
        assert.equal(result.variants.length, 2);
        assert.equal(result.variants.filter((v) => v.isActive).length, 1);
        saved = result;
        const runtime = createRuntimeDataSource();
        try {
          await runtime.initialize();
          await assert.rejects(
            runtime.query('UPDATE catalog_variants SET sku=sku WHERE product_id=$1', [saved.id]),
            { code: '42501' },
          );
          await assert.rejects(
            runtime.query('DELETE FROM catalog_products WHERE id=$1', [saved.id]),
            { code: '42501' },
          );
        } finally {
          if (runtime.isInitialized) await runtime.destroy();
        }
      },
    );

    await t.test(
      'search/filter pagination returns real counts and treats wildcard input literally',
      async () => {
        const all = await (
          await call(
            '/catalog/products?search=' + encodeURIComponent(prefix) + '&pageSize=1',
            reader,
          )
        ).json();
        assert.equal(all.items.length, 1);
        assert.ok(all.total >= 3);
        const result = await (
          await call('/catalog/products?search=' + encodeURIComponent(prefix + '-RETRY'), reader)
        ).json();
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].fromPrice, '1499.99');
        const wildcard = await (await call('/catalog/products?search=%25', reader)).json();
        assert.equal(wildcard.total, 0);
        assert.equal((await call('/catalog/products?pageSize=10000', reader)).status, 400);
      },
    );

    await t.test(
      'failed audit leaves no product, variants or consumed idempotency key',
      async () => {
        const trigger = 'catalog_probe_' + randomBytes(4).toString('hex'),
          body = payload('ROLLBACK'),
          key = randomUUID();
        await source.query(
          'CREATE FUNCTION "' +
            trigger +
            "\"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Intentional audit failure'; END; $$",
        );
        try {
          await source.query(
            'CREATE TRIGGER "' +
              trigger +
              '" BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.action=\'catalog.product_created\') EXECUTE FUNCTION "' +
              trigger +
              '"()',
          );
          const r = await call('/catalog/products', owner, body, key);
          assert.equal(r.status, 500);
          assert.equal(
            (
              await source.query(
                'SELECT count(*)::int AS total FROM catalog_products WHERE style_code=$1',
                [body.styleCode],
              )
            )[0].total,
            0,
          );
          assert.equal(
            (
              await source.query(
                'SELECT count(*)::int AS total FROM catalog_requests WHERE key=$1',
                [key],
              )
            )[0].total,
            0,
          );
        } finally {
          await source.query('DROP TRIGGER IF EXISTS "' + trigger + '" ON audit_events');
          await source.query('DROP FUNCTION "' + trigger + '"()');
        }
        assert.equal((await call('/catalog/products', owner, body, key)).status, 201);
      },
    );

    await t.test(
      'new catalog migration applies/reverts without altering the identity foundation',
      async () => {
        const runner = source.createQueryRunner(),
          schema = 'catalog_probe_' + randomBytes(4).toString('hex');
        try {
          await runner.startTransaction();
          await runner.query('CREATE SCHEMA "' + schema + '"');
          await runner.query('SET LOCAL search_path TO "' + schema + '",pg_catalog');
          const identity = new IdentityFoundation1794096000000(),
            catalog = new CatalogFoundation1794100000000();
          await identity.up(runner);
          await catalog.up(runner);
          assert.equal(
            (await runner.query('SELECT version FROM app_schema_version'))[0].version,
            2,
          );
          await catalog.down(runner);
          assert.equal(
            (await runner.query('SELECT version FROM app_schema_version'))[0].version,
            1,
          );
          await identity.down(runner);
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );
  } finally {
    try {
      if (app) await app.close();
      if (schemaReady)
        await source.transaction(async (m) => {
          const products: { id: string }[] = await m.query(
            'SELECT id FROM catalog_products WHERE style_code=ANY($1::text[])',
            [styles],
          );
          const ids = products.map((row) => row.id);
          await m.query('DELETE FROM catalog_requests WHERE resource_id=ANY($1::uuid[])', [ids]);
          await m.query('DELETE FROM catalog_variants WHERE product_id=ANY($1::uuid[])', [ids]);
          await m.query('DELETE FROM catalog_products WHERE id=ANY($1::uuid[])', [ids]);
          for (const id of [...categories].reverse())
            await m.query('DELETE FROM catalog_categories WHERE id=$1', [id]);
          await m.query(
            'DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[]) OR request_id=ANY($2::uuid[])',
            [users, requests],
          );
          await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [
            users,
          ]);
          await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [roles]);
          await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [roles]);
          await m.query('DELETE FROM locations WHERE id=$1', [location]);
          await m.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
            buckets,
          ]);
        });
    } finally {
      if (source.isInitialized) await source.destroy();
    }
  }
});
