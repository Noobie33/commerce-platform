import { salesInput } from '../src/modules/sales/sales.validation.js';
import { SalesReservations1794110000000 } from '../src/database/migrations/1794110000000-sales-reservations.js';
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
import { customerInput } from '../src/modules/customers/customer.validation.js';
test('sales stock holds: scoped availability, expiry and all stock-decreasing boundaries', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource();
  await db.initialize();
  const prefix = 'HOLD' + randomBytes(5).toString('hex').toUpperCase(),
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
    customerVersion = 1;
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
    const secondLocation = randomUUID();
    await db.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
      secondLocation,
      prefix + 'B',
      'Other hold warehouse',
    ]);
    for (const [userIndex, scope] of [
      [1, location],
      [2, secondLocation],
    ] as const) {
      const scopedRole = randomUUID();
      roles.push(scopedRole);
      await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [
        scopedRole,
        prefix + 'STOCK' + userIndex,
      ]);
      for (const permission of ['inventory.read', 'sales.reserve'])
        await db.query('INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)', [
          scopedRole,
          permission,
        ]);
      await db.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
        [users[userIndex], scopedRole, scope],
      );
    }
    for (const permission of ['inventory.read', 'sales.reserve'])
      await db.query('INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)', [
        roles[2],
        permission,
      ]);
    async function stock(
      kind: string,
      quantity: string,
      variant = variants[0],
      destinationId: string | null = null,
    ) {
      const r = await fetch(base + '/api/v1/inventory/postings', {
        method: 'POST',
        headers: { ...headers(), 'X-Idempotency-Key': randomUUID() },
        body: JSON.stringify({
          kind,
          locationId: location,
          destinationId,
          reason: 'Hold integration stock fixture',
          reference: prefix,
          lines: [{ variantId: variant, quantity }],
        }),
      });
      requests.push(r.headers.get('x-request-id')!);
      return r;
    }
    async function reversal(postingId: string) {
      const r = await fetch(base + '/api/v1/inventory/postings/' + postingId + '/reverse', {
        method: 'POST',
        headers: { ...headers(), 'X-Idempotency-Key': randomUUID() },
        body: JSON.stringify({ reason: 'Hold reversal boundary fixture', reference: prefix }),
      });
      requests.push(r.headers.get('x-request-id')!);
      return r;
    }
    async function newOrder(quantity = '3', both = false) {
      const b = body();
      b.lines = both ? b.lines : [{ ...b.lines[0]!, quantity }];
      const r = await call('/orders', b);
      assert.equal(r.status, 201);
      return (await r.json()).id as string;
    }
    const reservation = (id: string, who = 0) =>
      call('/orders/' + id + '/reservations', undefined, randomUUID(), who);
    async function holdInput(id: string) {
      const o = await (await call('/orders/' + id)).json(),
        p = await (await reservation(id)).json();
      return {
        expectedVersion: o.version,
        expectedRevision: p.revision,
        holdMinutes: 30,
        reason: 'Reserve customer stock while preparing order',
      };
    }
    async function hold(id: string, b?: unknown, k = randomUUID(), who = 0) {
      return call('/orders/' + id + '/reservations', b ?? (await holdInput(id)), k, who);
    }
    async function release(id: string, who = 0) {
      const o = await (await call('/orders/' + id)).json(),
        p = await (await reservation(id)).json();
      return call(
        '/orders/' + id + '/reservations/release',
        {
          expectedVersion: o.version,
          expectedRevision: p.revision,
          reservationId: p.current.id,
          reason: 'Release held stock for order correction',
        },
        randomUUID(),
        who,
      );
    }
    async function availability() {
      return db.query(
        'SELECT variant_id,on_hand::text,reserved::text,available::text FROM inventory_availability WHERE location_id=$1 ORDER BY variant_id',
        [location],
      );
    }
    const initial = await stock('receipt', '5');
    assert.equal(initial.status, 201);
    const receiptId = (await initial.json()).id;
    assert.equal((await stock('receipt', '2', variants[1])).status, 201);
    const id = await newOrder('3', true);
    await t.test(
      'global commercial read alone exposes no stock; scoped read/reserve and CSRF are enforced',
      async () => {
        const scoped = await (await reservation(id, 1)).json();
        assert.equal(scoped.visible, true);
        assert.equal(scoped.canManage, true);
        const hidden = await (await reservation(id, 2)).json();
        assert.equal(hidden.visible, false);
        assert.equal(hidden.lines.length, 0);
        assert.equal((await hold(id, await holdInput(id), randomUUID(), 2)).status, 403);
        assert.equal((await reservation(id, 3)).status, 403);
        const b = await holdInput(id),
          h = headers();
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        const r = await fetch(base + '/api/v1/sales/orders/' + id + '/reservations', {
          method: 'POST',
          headers: h,
          body: JSON.stringify(b),
        });
        requests.push(r.headers.get('x-request-id')!);
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      'concurrent unchanged holds reserve exact full draft quantities once, preserving physical stock and cash records',
      async () => {
        const b = await holdInput(id),
          k = randomUUID(),
          before = await counts();
        const responses = await Promise.all([hold(id, b, k, 1), hold(id, b, k, 1)]);
        for (const r of responses)
          assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
        assert.deepEqual(await responses[0]!.json(), await responses[1]!.json());
        assert.deepEqual(await counts(), before);
        const p = await (await reservation(id)).json();
        assert.equal(p.revision, 2);
        assert.equal(p.current.status, 'active');
        assert.equal(
          p.lines.find((l: { variantId: string }) => l.variantId === variants[0]).reserved,
          '3',
        );
        assert.equal(
          p.lines.find((l: { variantId: string }) => l.variantId === variants[1]).available,
          '0',
        );
        assert.equal((await (await call('/orders/' + id)).json()).stockReserved, true);
        assert.equal((await hold(id, { ...b, reason: 'Changed' }, k, 1)).status, 409);
      },
    );
    await t.test(
      'active holds block draft edits/cancellation and every physical deduction/reversal; failed work rolls back atomically',
      async () => {
        const o = await (await call('/orders/' + id)).json();
        for (const [path, b, method] of [
          ['/orders/' + id, { ...body(), expectedVersion: o.version }, 'PATCH'],
          [
            '/orders/' + id + '/cancel',
            { expectedVersion: o.version, reason: 'Blocked cancellation' },
            'POST',
          ],
        ] as const) {
          const r = await call(path, b, randomUUID(), 0, method);
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, 'SALES_RESERVED');
        }
        const before = await availability();
        for (const r of [
          await stock('adjustment', '-3'),
          await stock('transfer', '3', variants[0], secondLocation),
          await reversal(receiptId),
        ]) {
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, 'STOCK_RESERVED');
        }
        assert.deepEqual(await availability(), before);
        const r = await release(id, 1);
        assert.equal(r.status, 201);
        assert.equal((await (await reservation(id)).json()).current, null);
        assert.equal((await (await call('/orders/' + id)).json()).stockReserved, false);
      },
    );
    await t.test(
      'a failed multi-variant hold leaves no partial reservation or revision',
      async () => {
        const activeOrder = await newOrder('2', true);
        const active = await hold(activeOrder);
        assert.equal(active.status, 201);
        const b = body();
        b.lines = b.lines.map((l) => ({ ...l, quantity: '1' }));
        const created = await call('/orders', b);
        assert.equal(created.status, 201);
        const orderId = (await created.json()).id;
        const before = await availability(),
          requestKey = randomUUID();
        assert.equal((await hold(orderId, await holdInput(orderId), requestKey)).status, 409);
        assert.deepEqual(await availability(), before);
        assert.equal((await (await reservation(orderId)).json()).revision, 1);
        assert.equal(
          (await db.query('SELECT key FROM sales_reservation_requests WHERE key=$1', [requestKey]))
            .length,
          0,
        );
        assert.equal((await release(activeOrder)).status, 201);
      },
    );
    await t.test('different orders racing for final stock cannot over-reserve', async () => {
      const a = await newOrder('5'),
        b = await newOrder('5'),
        pa = await holdInput(a),
        pb = await holdInput(b);
      const results = await Promise.all([hold(a, pa), hold(b, pb)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const winner = results[0]!.status === 201 ? a : b;
      assert.equal(
        (await availability()).find(
          (r: { variant_id: string; available: string }) => r.variant_id === variants[0],
        ).available,
        '0',
      );
      assert.equal((await release(winner)).status, 201);
    });
    await t.test(
      'a stock deduction racing a hold consumes only available stock, with no negative availability',
      async () => {
        const o = await newOrder('5'),
          b = await holdInput(o);
        const results = await Promise.all([hold(o, b), stock('adjustment', '-1')]);
        assert.equal(results.filter((r) => r.status === 201).length, 1);
        assert.equal(results.filter((r) => r.status === 409).length, 1);
        for (const row of await availability()) assert(BigInt(row.available) >= 0n);
        if (results[0]!.status === 201) assert.equal((await release(o)).status, 201);
        else assert.equal((await stock('receipt', '1')).status, 201);
      },
    );
    await t.test(
      'older repeatable-read transactions cannot bypass new holds when editing drafts or decrementing balances',
      async () => {
        const o = await newOrder('5'),
          b = await holdInput(o),
          stockRunner = runtime.createQueryRunner(),
          orderRunner = runtime.createQueryRunner();
        await stockRunner.connect();
        await orderRunner.connect();
        try {
          await stockRunner.startTransaction('REPEATABLE READ');
          await orderRunner.startTransaction('REPEATABLE READ');
          await stockRunner.query('SELECT quantity FROM inventory_balances WHERE location_id=$1', [
            location,
          ]);
          await orderRunner.query('SELECT version FROM sales_orders WHERE id=$1', [o]);
          assert.equal((await hold(o, b)).status, 201);
          await assert.rejects(
            stockRunner.query('SELECT public.inventory_post($1,$2,$3,$4::jsonb)', [
              randomUUID(),
              users[0],
              randomUUID(),
              JSON.stringify({
                kind: 'adjustment',
                locationId: location,
                destinationId: null,
                reason: 'Old snapshot attempt',
                reference: prefix,
                lines: [{ variantId: variants[0], quantity: '-1' }],
              }),
            ]),
            { code: '40001' },
          );
          const canonical = salesInput({ ...body(), expectedVersion: 1 }, true);
          await assert.rejects(
            orderRunner.query('SELECT public.sales_draft_save($1,$2,$3,$4::jsonb)', [
              randomUUID(),
              users[0],
              randomUUID(),
              JSON.stringify({ kind: 'update', id: o, ...canonical }),
            ]),
            { code: '40001' },
          );
        } finally {
          if (stockRunner.isTransactionActive) await stockRunner.rollbackTransaction();
          if (orderRunner.isTransactionActive) await orderRunner.rollbackTransaction();
          await stockRunner.release();
          await orderRunner.release();
        }
        assert.equal((await release(o)).status, 201);
      },
    );
    await t.test(
      'expiry frees availability without a worker and replacement keeps expired history',
      async () => {
        const o = await newOrder('2');
        assert.equal((await hold(o)).status, 201);
        const p = await (await reservation(o)).json();
        await db.query(
          "UPDATE sales_reservations SET created_at=CURRENT_TIMESTAMP-interval '31 minutes',expires_at=CURRENT_TIMESTAMP-interval '1 minute' WHERE id=$1",
          [p.current.id],
        );
        const expired = await (await reservation(o)).json();
        assert.equal(expired.current.status, 'expired');
        assert.equal(expired.lines[0].available, '5');
        assert.equal((await (await call('/orders/' + o)).json()).stockReserved, false);
        assert.equal((await hold(o)).status, 201);
        const replaced = await (await reservation(o)).json();
        assert.equal(replaced.total, 2);
        assert.equal(
          replaced.items.find((h: { id: string }) => h.id === p.current.id).closeKind,
          'expiry',
        );
        assert.equal((await release(o)).status, 201);
      },
    );
    await t.test(
      'hold and release audit failures restore revision, availability and retry key; unchanged retries succeed',
      async () => {
        const o = await newOrder('2');
        for (const operation of ['hold', 'release']) {
          const p = await (await reservation(o)).json(),
            order = await (await call('/orders/' + o)).json(),
            k = randomUUID(),
            b =
              operation === 'hold'
                ? await holdInput(o)
                : {
                    expectedVersion: order.version,
                    expectedRevision: p.revision,
                    reservationId: p.current.id,
                    reason: 'Audited release fixture',
                  },
            path = '/orders/' + o + '/reservations' + (operation === 'release' ? '/release' : ''),
            name = 'hold_audit_' + prefix.toLowerCase(),
            before = await availability();
          await db.query(
            `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action LIKE 'sales.stock_%' THEN RAISE EXCEPTION 'Intentional reservation audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
          );
          try {
            assert.equal((await call(path, b, k)).status, 500);
            assert.deepEqual(await availability(), before);
            assert.equal((await (await reservation(o)).json()).revision, p.revision);
            assert.equal((await (await call('/orders/' + o)).json()).version, order.version);
            assert.equal(
              (await db.query('SELECT key FROM sales_reservation_requests WHERE key=$1', [k]))
                .length,
              0,
            );
          } finally {
            await db.query(
              'DROP TRIGGER ' + name + ' ON audit_events;DROP FUNCTION ' + name + '()',
            );
          }
          assert.equal((await call(path, b, k)).status, 201);
        }
      },
    );
    await t.test(
      'inactive locations still permit authorized release; revoked scope blocks cached retry',
      async () => {
        const o = await newOrder('2'),
          b = await holdInput(o),
          k = randomUUID();
        assert.equal((await hold(o, b, k, 1)).status, 201);
        const scopedRole = roles[3];
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='sales.reserve'",
          [scopedRole],
        );
        assert.equal((await hold(o, b, k, 1)).status, 403);
        await db.query('UPDATE locations SET is_active=false WHERE id=$1', [location]);
        try {
          assert.equal((await release(o)).status, 201);
        } finally {
          await db.query('UPDATE locations SET is_active=true WHERE id=$1', [location]);
        }
      },
    );
    await t.test(
      'history pagination preserves older holds while current availability remains exact',
      async () => {
        const o = await newOrder('1');
        for (let i = 0; i < 21; i++) {
          assert.equal((await hold(o)).status, 201);
          assert.equal((await release(o)).status, 201);
        }
        const first = await (await reservation(o)).json(),
          second = await (await call('/orders/' + o + '/reservations?page=2')).json();
        assert.equal(first.total, 21);
        assert.equal(first.items.length, 20);
        assert.equal(second.items.length, 1);
        assert.equal(second.current, null);
        assert.equal(second.lines[0].available, '5');
        assert.equal((await call('/orders/' + o + '/reservations?page=0')).status, 400);
      },
    );
    await t.test(
      'strict duration/revision inputs and direct runtime DML cannot bypass stock hold rules',
      async () => {
        const o = await newOrder('1'),
          b = await holdInput(o);
        for (const value of [
          { ...b, holdMinutes: 14 },
          { ...b, holdMinutes: 1441 },
          { ...b, holdMinutes: 30.5 },
          { ...b, reason: ' ' },
          { ...b, expectedRevision: '1' },
          { ...b, quantity: '1' },
        ])
          assert.equal((await hold(o, value)).status, 400);
        for (const sql of [
          'DELETE FROM sales_reservations WHERE false',
          'UPDATE sales_reservation_state SET version=1 WHERE false',
          'DELETE FROM sales_reservation_lines WHERE false',
          'DELETE FROM sales_reservation_requests WHERE false',
        ])
          await assert.rejects(runtime.query(sql), { code: '42501' });
      },
    );
    await t.test(
      'compiled migration protects history and reverts/reapplies in an empty scratch schema',
      async () => {
        const r = db.createQueryRunner(),
          schema = 'hold_scratch_' + prefix.toLowerCase();
        await r.connect();
        try {
          const next = new SalesReservations1794110000000();
          await assert.rejects(next.down(r), /Cannot discard/);
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET search_path TO ' + schema + ',public');
          for (const migration of db.migrations) await migration.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 12);
          await next.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 11);
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
          await m.query('DELETE FROM sales_reservation_requests WHERE actor_id=ANY($1::uuid[])', [
            users,
          ]);
          await m.query(
            'DELETE FROM sales_reservation_lines WHERE reservation_id IN(SELECT id FROM sales_reservations WHERE actor_id=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM sales_reservations WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM sales_reservation_state WHERE order_id IN(SELECT id FROM sales_orders WHERE created_by=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM inventory_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM inventory_entries WHERE location_id IN(SELECT id FROM locations WHERE code LIKE $1)',
            [prefix + '%'],
          );
          await m.query(
            'DELETE FROM inventory_balances WHERE location_id IN(SELECT id FROM locations WHERE code LIKE $1)',
            [prefix + '%'],
          );
          await m.query('DELETE FROM inventory_postings WHERE actor_id=ANY($1::uuid[])', [users]);
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
          await m.query('DELETE FROM locations WHERE code LIKE $1', [prefix + '%']);
          await m.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
            buckets,
          ]);
        });
    } finally {
      await db.destroy();
    }
  }
});
