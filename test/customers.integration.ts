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
import { CustomerFoundation1794108000000 } from '../src/database/migrations/1794108000000-customer-foundation.js';
import type { Customer, CustomerResult } from '../src/modules/customers/customer.types.js';
test('customer records: protected profiles, contact matching and independently controlled credit', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource();
  await db.initialize();
  const prefix = 'cust' + randomBytes(5).toString('hex'),
    users = Array.from({ length: 4 }, () => randomUUID()),
    names = users.map((_, i) => prefix + i),
    roles = [randomUUID(), randomUUID(), randomUUID()],
    location = randomUUID(),
    requests: string[] = [],
    origin = 'http://customers.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '',
    ready = false;
  const sessions: { cookie: string; csrf: string }[] = [];
  const buckets = [
    ...names.map((n) => tokenHash('user:' + n)),
    ...['ip:127.0.0.1', 'ip:::ffff:127.0.0.1'].map(tokenHash),
  ];
  function headers(who = 0) {
    return {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Requested-With': 'commerce-staff',
      Cookie: sessions[who]!.cookie,
      'X-CSRF-Token': sessions[who]!.csrf,
    };
  }
  async function call(path = '', body?: unknown, key = randomUUID(), who = 0, method?: string) {
    const r = await fetch(base + '/api/v1/customers' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...headers(who), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const request = r.headers.get('x-request-id');
    if (request) requests.push(request);
    return r;
  }
  const address = {
    line1: 'QA address',
    line2: '',
    area: 'Dhanmondi',
    district: 'Dhaka',
    postalCode: '১২০৯',
  };
  const body = () => ({
    customerKind: 'person',
    segment: 'retail',
    name: prefix + ' customer',
    contactName: 'QA contact',
    phone: '০১৭০০০০০০০০',
    email: 'Customer@Example.invalid',
    billingAddress: address,
    deliveryAddress: null,
    notes: 'Private QA notes',
    isActive: true,
  });
  let c: Customer,
    key = randomUUID(),
    created: CustomerResult;
  const credit = (version: number) => ({
    expectedVersion: version,
    creditEnabled: true,
    creditLimit: '25000.15',
    paymentTermsDays: 30,
    reason: 'Approved wholesale test terms',
  });
  try {
    await db.runMigrations();
    await grantRuntime(db, process.env);
    await runtime.initialize();
    ready = true;
    await db.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [buckets]);
    const hash = await new PasswordService().hash('Customer integration password 2026!');
    for (let i = 0; i < users.length; i++)
      await db.query(
        'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,$3,$4,false)',
        [users[i], names[i], 'Customer QA', hash],
      );
    await db.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [users[0]],
    );
    await db.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
      location,
      prefix.toUpperCase(),
      'Customer permission fixture',
    ]);
    for (let i = 0; i < roles.length; i++) {
      await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [
        roles[i],
        prefix.toUpperCase() + i,
      ]);
      for (const permission of [
        'customers.read',
        ...(i === 0
          ? ['customers.manage']
          : i === 1
            ? ['customers.credit.manage']
            : ['customers.manage', 'customers.credit.manage']),
      ])
        await db.query('INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)', [
          roles[i],
          permission,
        ]);
      await db.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
        [users[i + 1], roles[i], i === 2 ? location : null],
      );
    }
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
        body: JSON.stringify({ username, password: 'Customer integration password 2026!' }),
      });
      requests.push(r.headers.get('x-request-id')!);
      assert.equal(r.status, 200);
      sessions.push({
        cookie: r.headers.get('set-cookie')!.split(';')[0]!,
        csrf: (await r.json()).csrfToken,
      });
    }
    await t.test(
      'create normalizes Bengali phones and postal codes, auto-numbers and preserves original contact display',
      async () => {
        const r = await call('', body(), key);
        assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
        created = await r.json();
        c = await (await call('/' + created.id)).json();
        assert.match(c.code, /^CUST-\d{8,}$/);
        assert.equal(c.phone, '+8801700000000');
        assert.equal(c.billingAddress!.postalCode, '1209');
        assert.equal(c.email, 'Customer@Example.invalid');
        assert.equal(c.creditLimit, '0.00');
        assert.equal(c.version, 1);
        assert.equal(c.deliveryAddress, null);
      },
    );
    await t.test(
      'retries return minimal stable results; different bodies or actors cannot reuse a key',
      async () => {
        assert.deepEqual(await (await call('', body(), key)).json(), created);
        assert.equal((await call('', { ...body(), name: 'Changed' }, key)).status, 409);
        assert.equal((await call('', body(), key, 1)).status, 409);
        assert.deepEqual(Object.keys(created).sort(), ['id', 'kind', 'version']);
      },
    );
    await t.test(
      'concurrent create retries serialize while distinct requests receive distinct codes',
      async () => {
        const k = randomUUID();
        const responses = await Promise.all([call('', body(), k), call('', body(), k)]);
        assert(responses.every((r) => r.status === 201));
        assert.deepEqual(await responses[0]!.json(), await responses[1]!.json());
        const pair = await Promise.all([
          call('', { ...body(), phone: '', email: '' }),
          call('', { ...body(), phone: '', email: '' }),
        ]);
        const ids = await Promise.all(pair.map(async (r) => (await r.json()).id));
        const rows = await db.query('SELECT code FROM customers WHERE id=ANY($1::uuid[])', [ids]);
        assert.equal(rows.length, 2);
        assert.notEqual(rows[0].code, rows[1].code);
      },
    );
    await t.test(
      'shared contacts are allowed and exact matching canonicalizes phone and email without leaking addresses',
      async () => {
        const r = await call('', {
          ...body(),
          name: prefix + ' shared contact',
          customerKind: 'business',
          segment: 'wholesale',
        });
        assert.equal(r.status, 201);
        const id = (await r.json()).id;
        const matches = await (
          await call(
            '/contact-matches?' +
              new URLSearchParams({
                phone: '01700 000000',
                email: 'customer@example.invalid',
                excludeId: c.id,
              }),
          )
        ).json();
        assert(matches.items.some((m: { id: string }) => m.id === id));
        assert.equal(
          matches.items.some((m: { id: string }) => m.id === c.id),
          false,
        );
        assert.deepEqual(Object.keys(matches.items[0]).sort(), ['code', 'id', 'name']);
      },
    );
    await t.test(
      'strict inputs reject credit mass assignment, country, malformed contacts and fractional terms',
      async () => {
        for (const b of [
          { ...body(), code: 'FORGED' },
          { ...body(), creditEnabled: true },
          { ...body(), billingAddress: { ...address, country: 'US' } },
          { ...body(), phone: '017' },
          { ...body(), email: 'wrong' },
          { ...body(), billingAddress: { ...address, postalCode: '12' } },
          { ...body(), name: ' ' },
        ])
          assert.equal((await call('', b)).status, 400);
        assert.equal(
          (
            await call('/' + c.id + '/credit-policy', {
              ...credit(c.version),
              paymentTermsDays: 1.5,
            })
          ).status,
          400,
        );
        assert.equal((await call('?page=0')).status, 400);
      },
    );
    await t.test(
      'global profile and credit permissions are independent; location scopes and missing CSRF fail',
      async () => {
        assert.equal((await call('', body(), randomUUID(), 2)).status, 403);
        assert.equal(
          (await call('/' + c.id + '/credit-policy', credit(c.version), randomUUID(), 1)).status,
          403,
        );
        assert.equal(
          (await call('/' + c.id + '/credit-history', undefined, randomUUID(), 1)).status,
          403,
        );
        assert.equal((await call('', undefined, randomUUID(), 3)).status, 403);
        assert.equal((await call('', body(), randomUUID(), 3)).status, 403);
        const h = headers();
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        const r = await fetch(base + '/api/v1/customers', {
          method: 'POST',
          headers: h,
          body: JSON.stringify(body()),
        });
        requests.push(r.headers.get('x-request-id')!);
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      'concurrent edits allow one revision and stale forms cannot overwrite data',
      async () => {
        const results = await Promise.all(
          ['A', 'B'].map((s) =>
            call(
              '/' + c.id,
              { ...body(), name: prefix + s, expectedVersion: c.version },
              randomUUID(),
              0,
              'PATCH',
            ),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        c = await (await call('/' + c.id)).json();
        assert.equal(c.version, 2);
        assert.equal(
          c.code,
          (await db.query('SELECT code FROM customers WHERE id=$1', [c.id]))[0].code,
        );
      },
    );
    await t.test(
      'credit manager can record exact BDT policy with reason, immutable history and version conflict checks',
      async () => {
        const k = randomUUID(),
          b = credit(c.version);
        const r = await call('/' + c.id + '/credit-policy', b, k, 2);
        assert.equal(r.status, 201);
        const saved = await r.json();
        assert.deepEqual(await (await call('/' + c.id + '/credit-policy', b, k, 2)).json(), saved);
        assert.equal((await call('/' + c.id + '/credit-policy', b)).status, 409);
        c = await (await call('/' + c.id)).json();
        assert.equal(c.creditLimit, '25000.15');
        assert.equal(c.paymentTermsDays, 30);
        const h = await (
          await call('/' + c.id + '/credit-history', undefined, randomUUID(), 2)
        ).json();
        assert.equal(h.total, 1);
        assert.equal(h.items[0].currentPolicy.creditLimitMinor, '2500015');
        assert.equal(h.items[0].previousPolicy.creditEnabled, false);
        assert.equal(h.items[0].reason, b.reason);
      },
    );
    await t.test(
      'inactive profiles preserve policy, cannot enable credit, and disabling clears configured limit and terms',
      async () => {
        assert.equal(
          (
            await call(
              '/' + c.id,
              { ...body(), isActive: false, expectedVersion: c.version },
              randomUUID(),
              1,
              'PATCH',
            )
          ).status,
          200,
        );
        c = await (await call('/' + c.id)).json();
        assert.equal(c.creditEnabled, true);
        assert.equal((await call('/' + c.id + '/credit-policy', credit(c.version))).status, 409);
        assert.equal(
          (
            await call('/' + c.id + '/credit-policy', {
              expectedVersion: c.version,
              creditEnabled: false,
              creditLimit: '0.00',
              paymentTermsDays: 0,
              reason: 'Disabled inactive account',
            })
          ).status,
          201,
        );
        c = await (await call('/' + c.id)).json();
        assert.equal(c.creditLimit, '0.00');
        assert.equal(
          (await call('?status=inactive&search=' + encodeURIComponent(c.code))).status,
          200,
        );
      },
    );
    await t.test(
      'audit failure rolls back profile and credit history, version and retry key; same-key retry succeeds',
      async () => {
        for (const operation of ['create', 'credit']) {
          const name = 'customer_audit_' + prefix,
            k = randomUUID();
          const input =
            operation === 'create'
              ? body()
              : {
                  expectedVersion: c.version,
                  creditEnabled: false,
                  creditLimit: '0',
                  paymentTermsDays: 0,
                  reason: 'Rollback fixture',
                };
          const path = operation === 'create' ? '' : '/' + c.id + '/credit-policy';
          const before = await db.query('SELECT version FROM customers WHERE id=$1', [c.id]);
          await db.query(
            `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action LIKE 'customers.%' THEN RAISE EXCEPTION 'Intentional customer audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
          );
          try {
            const r = await call(path, input, k);
            assert.equal(r.status, 500);
            assert.equal(JSON.stringify(await r.json()).includes('Intentional'), false);
            assert.equal(
              (await db.query('SELECT key FROM customer_requests WHERE key=$1', [k])).length,
              0,
            );
            assert.deepEqual(
              await db.query('SELECT version FROM customers WHERE id=$1', [c.id]),
              before,
            );
          } finally {
            await db.query(
              'DROP TRIGGER ' + name + ' ON audit_events;DROP FUNCTION ' + name + '()',
            );
          }
          assert.equal((await call(path, input, k)).status, 201);
          c = await (await call('/' + c.id)).json();
        }
      },
    );
    await t.test(
      'runtime cannot alter records directly; generic audit and response cache contain no duplicated PII',
      async () => {
        for (const sql of [
          "UPDATE customers SET name='FORGED' WHERE false",
          'DELETE FROM customer_credit_history WHERE false',
          'INSERT INTO customers(id) VALUES(gen_random_uuid())',
          'DELETE FROM customer_requests WHERE false',
        ])
          await assert.rejects(runtime.query(sql), { code: '42501' });
        const rows = await db.query(
          "SELECT metadata FROM audit_events WHERE actor_id=ANY($1::uuid[]) AND action LIKE 'customers.%'",
          [users],
        );
        for (const r of rows)
          assert.deepEqual(Object.keys(r.metadata).sort(), ['entityId', 'version']);
        const cache = await db.query(
          'SELECT response FROM customer_requests WHERE actor_id=ANY($1::uuid[])',
          [users],
        );
        for (const r of cache)
          assert.deepEqual(Object.keys(r.response).sort(), ['id', 'kind', 'version']);
      },
    );
    await t.test(
      'directory paginates real totals and literal wildcard search without requiring contact fields',
      async () => {
        for (let i = 0; i < 22; i++) {
          const r = await call('', {
            ...body(),
            name: prefix + ' batch ' + (i === 0 ? '%' : i),
            phone: '',
            email: '',
            contactName: '',
            billingAddress: null,
          });
          assert.equal(r.status, 201);
        }
        const q = new URLSearchParams({ search: prefix + ' batch' });
        const first = await (await call('?' + q)).json();
        assert.equal(first.total, 22);
        assert.equal(first.items.length, 20);
        const second = await (await call('?' + q + '&page=2')).json();
        assert.equal(second.items.length, 2);
        assert.equal(
          new Set([...first.items, ...second.items].map((c: Customer) => c.id)).size,
          22,
        );
        const literal = await (await call('?search=%25')).json();
        assert.equal(literal.total, 1);
        assert.equal((await call('?unknown=1')).status, 400);
        assert.equal((await call('/' + randomUUID())).status, 404);
      },
    );
    await t.test('revoked write permission takes effect before cached replay', async () => {
      const k = randomUUID();
      const r = await call('', body(), k, 1);
      assert.equal(r.status, 201);
      await db.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='customers.manage'",
        [roles[0]],
      );
      assert.equal((await call('', body(), k, 1)).status, 403);
    });
    await t.test(
      'compiled migration refuses discarding customers and safely reverts/reapplies an empty scratch schema',
      async () => {
        const r = db.createQueryRunner();
        await r.connect();
        const schema = 'customer_scratch_' + prefix;
        try {
          await assert.rejects(new CustomerFoundation1794108000000().down(r), /Cannot discard/);
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET search_path TO ' + schema + ',public');
          const migrations = db.migrations;
          for (const migration of migrations) await migration.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 10);
          const next = new CustomerFoundation1794108000000();
          await next.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 9);
          await next.up(r);
          assert.equal((await r.query('SELECT count(*)::int AS n FROM customers'))[0].n, 0);
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
          await m.query('DELETE FROM customer_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM customer_credit_history WHERE actor_id=ANY($1::uuid[])', [
            users,
          ]);
          await m.query('DELETE FROM customers WHERE created_by=ANY($1::uuid[])', [users]);
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
