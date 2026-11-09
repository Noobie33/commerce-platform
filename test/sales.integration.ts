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
import { PasswordService } from '../src/modules/identity/password.service.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { SalesDrafts1794109000000 } from '../src/database/migrations/1794109000000-sales-drafts.js';
import { customerInput } from '../src/modules/customers/customer.validation.js';
import type { SalesOrder, SalesResult } from '../src/modules/sales/sales.types.js';
test('sales drafts: exact pricing, protected snapshots, safe retry and no financial or stock effects', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource();
  await db.initialize();
  const prefix = 'SALE' + randomBytes(5).toString('hex').toUpperCase(),
    users = Array.from({ length: 4 }, () => randomUUID()),
    roles = Array.from({ length: 3 }, () => randomUUID()),
    names = users.map((_, i) => (prefix + i).toLowerCase()),
    location = randomUUID(),
    product = randomUUID(),
    variants = [randomUUID(), randomUUID()],
    requests: string[] = [],
    origin = 'http://sales.test',
    sessions: { cookie: string; csrf: string }[] = [];
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '',
    ready = false,
    customerId = '',
    customerVersion = 1,
    order: SalesOrder,
    key = randomUUID(),
    saved: SalesResult;
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
  async function call(path: string, body?: unknown, k = randomUUID(), who = 0, method?: string) {
    const r = await fetch(base + '/api/v1/sales' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...headers(who), 'X-Idempotency-Key': k },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    requests.push(r.headers.get('x-request-id')!);
    return r;
  }
  const body = () => ({
    customerId,
    customerVersion,
    locationId: location,
    channel: 'retail',
    fulfillOn: '2026-12-15',
    reference: prefix,
    notes: 'Private test sales note',
    priceReason: '',
    lines: [
      { variantId: variants[0], quantity: '3', unitPrice: '100.10', priceMode: 'catalog' },
      { variantId: variants[1], quantity: '2', unitPrice: '250.05', priceMode: 'catalog' },
    ],
  });
  const counts = async () =>
    (
      await db.query(
        'SELECT (SELECT count(*)::int FROM inventory_postings) AS postings,(SELECT count(*)::int FROM inventory_entries) AS entries,(SELECT count(*)::int FROM inventory_balances) AS balances,(SELECT coalesce(sum(quantity),0)::text FROM inventory_balances) AS quantity,(SELECT count(*)::int FROM supplier_invoices) AS invoices,(SELECT count(*)::int FROM supplier_payments) AS payments',
      )
    )[0];
  let before: unknown;
  try {
    await db.runMigrations();
    await grantRuntime(db, process.env);
    await runtime.initialize();
    ready = true;
    await db.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [buckets]);
    const hash = await new PasswordService().hash('Sales integration password 2026!');
    for (let i = 0; i < users.length; i++)
      await db.query(
        'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,$3,$4,false)',
        [users[i], names[i], 'Sales fixture', hash],
      );
    await db.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [users[0]],
    );
    await db.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
      location,
      prefix,
      'Sales test warehouse',
    ]);
    for (let i = 0; i < roles.length; i++) {
      await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [roles[i], prefix + i]);
      for (const p of [
        'sales.read',
        ...(i === 1 ? [] : ['sales.manage']),
        ...(i === 2 ? ['sales.price_override'] : []),
      ])
        await db.query('INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)', [
          roles[i],
          p,
        ]);
      await db.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
        [users[i + 1], roles[i], i === 2 ? location : null],
      );
    }
    await db.query(
      "INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,$2,'Sales cotton tee','active')",
      [product, prefix],
    );
    for (let i = 0; i < variants.length; i++)
      await db.query(
        'INSERT INTO catalog_variants(id,product_id,sku,attributes,options_key,price_minor) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
        [
          variants[i],
          product,
          prefix + '-' + i,
          JSON.stringify({ size: i ? 'L' : 'M', colour: 'Ivory' }),
          String(i).repeat(64),
          i ? 25005 : 10010,
        ],
      );
    const input = customerInput({
      customerKind: 'business',
      segment: 'both',
      name: prefix + ' customer',
      phone: '01700000000',
      email: 'sample@example.invalid',
      billingAddress: {
        line1: 'QA billing address',
        area: 'Dhaka',
        district: 'Dhaka',
        postalCode: '1209',
      },
      isActive: true,
      notes: 'Private customer note',
    });
    customerId = (
      await db.query('SELECT public.customer_save($1,$2,$3,$4::jsonb) AS r', [
        randomUUID(),
        users[0],
        randomUUID(),
        JSON.stringify({ kind: 'create', ...input }),
      ])
    )[0].r.id;
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
        body: JSON.stringify({ username, password: 'Sales integration password 2026!' }),
      });
      requests.push(r.headers.get('x-request-id')!);
      assert.equal(r.status, 200);
      sessions.push({
        cookie: r.headers.get('set-cookie')!.split(';')[0]!,
        csrf: (await r.json()).csrfToken,
      });
    }
    before = await counts();
    await t.test(
      'sales lookup uses active records, global sales read and bounded product prices without physical balances',
      async () => {
        const r = await call('/variants?search=' + prefix);
        assert.equal(r.status, 200);
        const rows = await r.json();
        assert.equal(rows.length, 2);
        assert.equal(rows[0].catalogPrice, '100.10');
        assert.equal(Object.hasOwn(rows[0], 'stock'), false);
        const c = await (await call('/customers?search=' + prefix)).json();
        assert.equal(c[0].id, customerId);
        assert.equal(Object.hasOwn(c[0], 'notes'), false);
        assert.equal((await call('/orders', undefined, randomUUID(), 3)).status, 403);
      },
    );
    await t.test(
      'concurrent create retries make one numbered draft, exact multi-line total and minimal cached response',
      async () => {
        const replies = await Promise.all([
          call('/orders', body(), key),
          call('/orders', body(), key),
        ]);
        for (const r of replies)
          assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
        saved = await replies[0]!.json();
        assert.deepEqual(await replies[1]!.json(), saved);
        assert.deepEqual(Object.keys(saved).sort(), ['id', 'kind', 'version']);
        order = await (await call('/orders/' + saved.id)).json();
        assert.equal(order.total, '800.40');
        assert.match(order.number, /^SO-\d{10,}$/);
        assert.equal(order.lines.length, 2);
        assert.equal(order.customerSnapshot.billingAddress!.line1, 'QA billing address');
        assert.equal((await call('/orders', { ...body(), reference: 'Changed' }, key)).status, 409);
        assert.equal((await call('/orders', body(), key, 1)).status, 409);
      },
    );
    await t.test(
      'read-only/scoped roles, CSRF and price override authorization fail before changes',
      async () => {
        assert.equal((await call('/orders', body(), randomUUID(), 2)).status, 403);
        assert.equal((await call('/orders', body(), randomUUID(), 3)).status, 403);
        const b = body();
        b.lines[0] = { ...b.lines[0]!, priceMode: 'override', unitPrice: '80.00' };
        b.priceReason = 'Trade price test';
        assert.equal((await call('/orders', b, randomUUID(), 1)).status, 403);
        const h = headers();
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        const r = await fetch(base + '/api/v1/sales/orders', {
          method: 'POST',
          headers: h,
          body: JSON.stringify(body()),
        });
        requests.push(r.headers.get('x-request-id')!);
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      'strict inputs reject duplicate lines, invalid dates, mass assignment, precision and overflow',
      async () => {
        const b = body();
        for (const value of [
          { ...b, status: 'confirmed' },
          { ...b, total: '1' },
          { ...b, fulfillOn: '2026-02-30' },
          { ...b, lines: [b.lines[0], b.lines[0]] },
          { ...b, lines: [{ ...b.lines[0], quantity: '1.5' }] },
          { ...b, lines: [{ ...b.lines[0], unitPrice: '1.001' }] },
          { ...b, lines: [{ ...b.lines[0], quantity: '999999999', unitPrice: '9999999999.99' }] },
          { ...b, lines: [{ ...b.lines[0], priceMode: 'override' }] },
        ])
          assert.equal((await call('/orders', value)).status, 400);
        assert.equal((await call('/orders?unknown=1')).status, 400);
        assert.equal((await call('/orders?page=0')).status, 400);
      },
    );
    await t.test(
      'inactive customers, locations, products and mismatched customer segments fail safely',
      async () => {
        for (const [table, id] of [
          ['customers', customerId],
          ['locations', location],
        ] as const) {
          await db.query('UPDATE ' + table + ' SET is_active=false WHERE id=$1', [id]);
          try {
            assert.equal((await call('/orders', body())).status, 409);
          } finally {
            await db.query('UPDATE ' + table + ' SET is_active=true WHERE id=$1', [id]);
          }
        }
        await db.query("UPDATE catalog_products SET status='draft' WHERE id=$1", [product]);
        try {
          assert.equal((await call('/orders', body())).status, 409);
          assert.equal((await (await call('/variants?search=' + prefix)).json()).length, 0);
        } finally {
          await db.query("UPDATE catalog_products SET status='active' WHERE id=$1", [product]);
        }
        await db.query("UPDATE customers SET segment='wholesale' WHERE id=$1", [customerId]);
        try {
          assert.equal((await call('/orders', body())).status, 409);
        } finally {
          await db.query("UPDATE customers SET segment='both' WHERE id=$1", [customerId]);
        }
      },
    );
    await t.test(
      'saved customer/product snapshots remain stable; stale current customer and catalog prices need explicit refresh',
      async () => {
        await db.query('UPDATE customers SET name=$2,version=version+1 WHERE id=$1', [
          customerId,
          prefix + ' updated customer',
        ]);
        customerVersion = 2;
        await db.query("UPDATE catalog_products SET name='Updated sales cotton tee' WHERE id=$1", [
          product,
        ]);
        const old = await (await call('/orders/' + order.id)).json();
        assert.equal(old.customerName, prefix + ' customer');
        assert.equal(old.lines[0].productName, 'Sales cotton tee');
        assert.equal((await call('/orders', { ...body(), customerVersion: 1 })).status, 409);
        await db.query('UPDATE catalog_variants SET price_minor=price_minor+1 WHERE id=$1', [
          variants[0],
        ]);
        try {
          const r = await call('/orders', body());
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, 'SALES_PRICE_CHANGED');
        } finally {
          await db.query('UPDATE catalog_variants SET price_minor=price_minor-1 WHERE id=$1', [
            variants[0],
          ]);
        }
      },
    );
    await t.test(
      'concurrent draft edits preserve one revision and never overwrite the winning lines',
      async () => {
        const results = await Promise.all(
          ['A', 'B'].map((s) =>
            call(
              '/orders/' + order.id,
              { ...body(), reference: prefix + s, expectedVersion: order.version },
              randomUUID(),
              0,
              'PATCH',
            ),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        order = await (await call('/orders/' + order.id)).json();
        assert.equal(order.version, 2);
        assert.equal(order.customerName, prefix + ' updated customer');
        assert.equal(order.total, '800.40');
      },
    );
    await t.test(
      'authorized override freezes catalog comparison and reason; revoked permission blocks cached replay',
      async () => {
        await db.query(
          "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'sales.price_override')",
          [roles[0]],
        );
        const b = body();
        b.lines[0] = { ...b.lines[0]!, unitPrice: '80.05', priceMode: 'override' };
        b.priceReason = 'Approved trade quote';
        const k = randomUUID(),
          r = await call('/orders', b, k, 1);
        assert.equal(r.status, 201);
        const id = (await r.json()).id,
          d = await (await call('/orders/' + id)).json();
        assert.equal(d.total, '740.25');
        assert.equal(d.lines[0].catalogPrice, '100.10');
        assert.equal(d.lines[0].unitPrice, '80.05');
        assert.equal(d.priceReason, b.priceReason);
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='sales.price_override'",
          [roles[0]],
        );
        assert.equal((await call('/orders', b, k, 1)).status, 403);
      },
    );
    await t.test(
      'audit failure rolls back replacement lines, snapshots, total, version and retry key; unchanged retry succeeds',
      async () => {
        const name = 'sales_audit_' + prefix.toLowerCase(),
          k = randomUUID(),
          b = {
            ...body(),
            expectedVersion: order.version,
            lines: [{ ...body().lines[0]!, quantity: '7' }],
          };
        const previous = await (await call('/orders/' + order.id)).json();
        await db.query(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action='sales.draft_updated' THEN RAISE EXCEPTION 'Intentional sales audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
        try {
          const r = await call('/orders/' + order.id, b, k, 0, 'PATCH');
          assert.equal(r.status, 500);
          assert.equal(JSON.stringify(await r.json()).includes('Intentional'), false);
          assert.deepEqual(await (await call('/orders/' + order.id)).json(), previous);
          assert.equal(
            (await db.query('SELECT key FROM sales_requests WHERE key=$1', [k])).length,
            0,
          );
        } finally {
          await db.query('DROP TRIGGER ' + name + ' ON audit_events;DROP FUNCTION ' + name + '()');
        }
        assert.equal((await call('/orders/' + order.id, b, k, 0, 'PATCH')).status, 200);
        order = await (await call('/orders/' + order.id)).json();
        assert.equal(order.total, '700.70');
      },
    );
    await t.test(
      'cancellation is reviewed-version safe, idempotent and preserves lines and snapshots; cancelled drafts cannot edit',
      async () => {
        const k = randomUUID(),
          b = { expectedVersion: order.version, reason: 'Customer declined draft' };
        assert.equal(
          (await call('/orders/' + order.id + '/cancel', { ...b, reason: ' ' })).status,
          400,
        );
        const r = await call('/orders/' + order.id + '/cancel', b, k);
        assert.equal(r.status, 201);
        const cancelled = await r.json();
        assert.deepEqual(
          await (await call('/orders/' + order.id + '/cancel', b, k)).json(),
          cancelled,
        );
        order = await (await call('/orders/' + order.id)).json();
        assert.equal(order.status, 'cancelled');
        assert.equal(order.lines.length, 1);
        assert.equal(order.total, '700.70');
        assert.equal(order.cancellationReason, b.reason);
        assert.equal(
          (
            await call(
              '/orders/' + order.id,
              { ...body(), expectedVersion: order.version },
              randomUUID(),
              0,
              'PATCH',
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      'concurrent edit and cancellation cannot both consume the same draft revision',
      async () => {
        const fresh = await (await call('/orders', body())).json();
        const responses = await Promise.all([
          call(
            '/orders/' + fresh.id,
            { ...body(), expectedVersion: 1, reference: 'Concurrent edit' },
            randomUUID(),
            0,
            'PATCH',
          ),
          call('/orders/' + fresh.id + '/cancel', {
            expectedVersion: 1,
            reason: 'Concurrent cancellation',
          }),
        ]);
        assert.equal(responses.filter((r) => r.status >= 200 && r.status < 300).length, 1);
        assert.equal(responses.filter((r) => r.status === 409).length, 1);
      },
    );
    await t.test(
      'creation and cancellation audit failures leave no partial document or consumed retry key',
      async () => {
        let fresh: SalesOrder | undefined;
        for (const operation of ['create', 'cancel']) {
          const action = operation === 'create' ? 'sales.draft_created' : 'sales.draft_cancelled',
            name = 'sales_fail_' + prefix.toLowerCase(),
            k = randomUUID(),
            path = operation === 'create' ? '/orders' : '/orders/' + fresh!.id + '/cancel',
            input =
              operation === 'create'
                ? body()
                : { expectedVersion: fresh!.version, reason: 'Audited cancellation fixture' };
          const beforeCount = (await db.query('SELECT count(*)::int AS n FROM sales_orders'))[0].n;
          await db.query(
            `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'Intentional sales audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
          );
          try {
            assert.equal((await call(path, input, k)).status, 500);
            assert.equal(
              (await db.query('SELECT count(*)::int AS n FROM sales_orders'))[0].n,
              beforeCount,
            );
            assert.equal(
              (await db.query('SELECT key FROM sales_requests WHERE key=$1', [k])).length,
              0,
            );
            if (fresh)
              assert.equal((await (await call('/orders/' + fresh.id)).json()).status, 'draft');
          } finally {
            await db.query(
              'DROP TRIGGER ' + name + ' ON audit_events;DROP FUNCTION ' + name + '()',
            );
          }
          const retried = await call(path, input, k);
          assert.equal(retried.status, 201);
          const result = await retried.json();
          fresh = await (await call('/orders/' + result.id)).json();
        }
      },
    );
    await t.test(
      'runtime cannot rewrite drafts, lines or request cache; generic audit and retry responses do not copy customer PII',
      async () => {
        for (const sql of [
          'UPDATE sales_orders SET total_minor=1 WHERE false',
          'DELETE FROM sales_order_lines WHERE false',
          'DELETE FROM sales_requests WHERE false',
          'INSERT INTO sales_order_lines(id) VALUES(gen_random_uuid())',
          "SELECT nextval('sales_order_number')",
        ])
          await assert.rejects(runtime.query(sql), { code: '42501' });
        const rows = await db.query(
          "SELECT metadata FROM audit_events WHERE actor_id=ANY($1::uuid[]) AND action LIKE 'sales.%'",
          [users],
        );
        for (const r of rows)
          assert.deepEqual(Object.keys(r.metadata).sort(), ['entityId', 'version']);
        const cache = await db.query(
          'SELECT response FROM sales_requests WHERE actor_id=ANY($1::uuid[])',
          [users],
        );
        for (const r of cache)
          assert.deepEqual(Object.keys(r.response).sort(), ['id', 'kind', 'version']);
      },
    );
    await t.test(
      'sales list pagination and literal search use preserved customer snapshots and include cancelled history',
      async () => {
        for (let i = 0; i < 22; i++)
          assert.equal(
            (
              await call('/orders', {
                ...body(),
                reference: prefix + ' batch ' + (i === 0 ? '%' : i),
              })
            ).status,
            201,
          );
        const q = new URLSearchParams({ search: prefix + ' batch' }),
          first = await (await call('/orders?' + q)).json(),
          second = await (await call('/orders?' + q + '&page=2')).json();
        assert.equal(first.total, 22);
        assert.equal(first.items.length, 20);
        assert.equal(second.items.length, 2);
        assert.equal((await (await call('/orders?search=%25')).json()).total, 1);
        const cancelled = await (
          await call('/orders?status=cancelled&search=' + order.number)
        ).json();
        assert.equal(cancelled.total, 1);
        assert.equal((await call('/orders/' + randomUUID())).status, 404);
      },
    );
    await t.test(
      'fresh write revocation applies before cached replay and all drafts leave stock/payment records unchanged',
      async () => {
        const replayKey = randomUUID(),
          replayBody = body();
        assert.equal((await call('/orders', replayBody, replayKey, 1)).status, 201);
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='sales.manage'",
          [roles[0]],
        );
        assert.equal((await call('/orders', replayBody, replayKey, 1)).status, 403);
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      'compiled migration refuses dropping sales history and reverts/reapplies an empty isolated schema',
      async () => {
        const r = db.createQueryRunner(),
          schema = 'sales_scratch_' + prefix.toLowerCase();
        await r.connect();
        try {
          const next = new SalesDrafts1794109000000();
          await assert.rejects(next.down(r), /Cannot discard/);
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET search_path TO ' + schema + ',public');
          for (const migration of db.migrations) {
            await migration.up(r);
            if (migration instanceof SalesDrafts1794109000000) break;
          }
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 11);
          await next.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 10);
          await next.up(r);
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
    try {
      if (ready)
        await db.transaction(async (m) => {
          await m.query('DELETE FROM sales_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM sales_order_lines WHERE order_id IN(SELECT id FROM sales_orders WHERE created_by=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM sales_orders WHERE created_by=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM customer_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM customers WHERE created_by=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM catalog_variants WHERE product_id=$1', [product]);
          await m.query('DELETE FROM catalog_products WHERE id=$1', [product]);
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
      await db.destroy();
    }
  }
});
