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
import { orderInput, supplierInput } from '../src/modules/purchasing/purchasing.validation.js';
import type { Supplier, PurchaseOrder } from '../src/modules/purchasing/purchasing.types.js';
import { IdentityFoundation1794096000000 } from '../src/database/migrations/1794096000000-identity-foundation.js';
import { CatalogFoundation1794100000000 } from '../src/database/migrations/1794100000000-catalog-foundation.js';
import { ProductMedia1794101000000 } from '../src/database/migrations/1794101000000-product-media.js';
import { OriginalMedia1794102000000 } from '../src/database/migrations/1794102000000-original-media.js';
import { InventoryFoundation1794103000000 } from '../src/database/migrations/1794103000000-inventory-foundation.js';
import { PurchasingFoundation1794104000000 } from '../src/database/migrations/1794104000000-purchasing-foundation.js';
test('purchasing: supplier and purchase order HTTP lifecycle, exact costs and database protection', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  const prefix = 'PUR' + randomBytes(5).toString('hex').toUpperCase(),
    users = [randomUUID(), randomUUID(), randomUUID()],
    names = users.map((_, i) => (prefix + i).toLowerCase()),
    roles = [randomUUID(), randomUUID()],
    location = randomUUID(),
    product = randomUUID(),
    variant = randomUUID();
  const buckets = [
      ...names.map((n) => tokenHash('user:' + n)),
      ...['ip:127.0.0.1', 'ip:::ffff:127.0.0.1'].map(tokenHash),
    ],
    requests: string[] = [];
  const origin = 'http://purchasing.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '',
    ready = false;
  type Session = { cookie: string; csrf: string };
  const sessions: Session[] = [];
  const headers = (s: Session) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: s.cookie,
    'X-CSRF-Token': s.csrf,
  });
  async function call(path: string, body?: unknown, key = randomUUID(), who = 0, method?: string) {
    const r = await fetch(base + '/api/v1/purchasing' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...headers(sessions[who]!), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const id = r.headers.get('x-request-id');
    if (id) requests.push(id);
    return r;
  }
  const supplierBody = () => ({
    code: prefix,
    name: 'QA clothing supplier',
    contactName: 'Purchasing fixture',
    phone: '+880 1700000000',
    email: 'fixture@example.invalid',
    address: 'Test address',
    taxReference: '',
    notes: 'Disposable integration fixture',
    isActive: true,
  });
  let supplier: Supplier, order: PurchaseOrder;
  const orderBody = () => ({
    supplierId: supplier.id,
    locationId: location,
    expectedOn: '2026-12-15',
    reference: prefix,
    notes: 'Clothing procurement fixture',
    lines: [{ variantId: variant, quantity: '3', unitCost: '100.10' }],
  });
  try {
    await db.runMigrations();
    await grantRuntime(db, process.env);
    ready = true;
    await db.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [buckets]);
    const password = 'Purchasing integration password 2026!',
      hash = await new PasswordService().hash(password);
    for (let i = 0; i < users.length; i++)
      await db.query(
        'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,$3,$4,false)',
        [users[i], names[i], 'Purchasing fixture', hash],
      );
    await db.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [users[0]],
    );
    for (let i = 0; i < roles.length; i++) {
      await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [roles[i], prefix + i]);
      await db.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'purchasing.read')",
        [roles[i]],
      );
    }
    await db.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
      location,
      prefix,
      'Purchasing test warehouse',
    ]);
    await db.query(
      'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,NULL),($3,$4,$5)',
      [users[1], roles[0], users[2], roles[1], location],
    );
    await db.query(
      "INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,$2,'Purchasing cotton tee','active')",
      [product, prefix],
    );
    await db.query(
      "INSERT INTO catalog_variants(id,product_id,sku,attributes,options_key,price_minor) VALUES($1,$2,$3,'{}',$4,10000)",
      [variant, product, prefix + '-M', 'a'.repeat(64)],
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
        body: JSON.stringify({ username, password }),
      });
      const id = r.headers.get('x-request-id');
      if (id) requests.push(id);
      assert.equal(r.status, 200);
      const b = await r.json();
      sessions.push({ cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: b.csrfToken });
    }
    await t.test(
      'purchasing needs global permission; read-only roles and CSRF cannot write',
      async () => {
        assert.equal((await fetch(base + '/api/v1/purchasing/suppliers')).status, 401);
        assert.equal((await call('/suppliers', undefined, randomUUID(), 2)).status, 403);
        assert.equal((await call('/suppliers', undefined, randomUUID(), 1)).status, 200);
        assert.equal((await call('/suppliers', supplierBody(), randomUUID(), 1)).status, 403);
        const r = await fetch(base + '/api/v1/purchasing/suppliers', {
          method: 'POST',
          headers: { ...headers(sessions[0]!), 'X-CSRF-Token': '' },
          body: JSON.stringify(supplierBody()),
        });
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      'concurrent supplier retries produce one record and protect code/version',
      async () => {
        const key = randomUUID(),
          body = supplierBody(),
          r = await Promise.all([call('/suppliers', body, key), call('/suppliers', body, key)]);
        assert.deepEqual(
          r.map((v) => v.status),
          [201, 201],
        );
        supplier = await r[0]!.json();
        assert.deepEqual(await r[1]!.json(), supplier);
        assert.equal((await call('/suppliers', { ...body, name: 'Changed' }, key)).status, 409);
        assert.equal((await call('/suppliers', body)).status, 409);
        const edit = { ...body, name: 'QA supplier updated', expectedVersion: supplier.version };
        const saves = await Promise.all([
          call('/suppliers/' + supplier.id, edit, randomUUID(), 0, 'PATCH'),
          call('/suppliers/' + supplier.id, edit, randomUUID(), 0, 'PATCH'),
        ]);
        assert.deepEqual(saves.map((v) => v.status).sort(), [200, 409]);
        supplier = await (await call('/suppliers/' + supplier.id)).json();
        assert.equal(
          (
            await call(
              '/suppliers/' + supplier.id,
              { ...body, code: prefix + '-NEW', expectedVersion: supplier.version },
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
      'draft orders use exact money and concurrent retries do not duplicate documents',
      async () => {
        const key = randomUUID(),
          r = await Promise.all([
            call('/orders', orderBody(), key),
            call('/orders', orderBody(), key),
          ]);
        assert.deepEqual(
          r.map((v) => v.status),
          [201, 201],
        );
        order = await r[0]!.json();
        assert.deepEqual(await r[1]!.json(), order);
        assert.equal(order.total, '300.30');
        assert.equal(order.lines[0]!.lineTotal, '300.30');
        assert.match(order.number, /^PO-\d{10}$/);
        assert.equal(order.status, 'draft');
        assert.equal(
          (
            await call('/orders', {
              ...orderBody(),
              lines: [{ variantId: variant, quantity: '2', unitCost: 0.1 }],
            })
          ).status,
          400,
        );
        assert.equal(
          (await call('/orders', { ...orderBody(), expectedOn: '2026-13-01' })).status,
          400,
        );
        assert.equal(
          (
            await call('/orders', {
              ...orderBody(),
              lines: [{ variantId: variant, quantity: '999999999', unitCost: '9999999999.99' }],
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      'simultaneous draft edits detect stale versions; failed SKU replacement rolls back',
      async () => {
        const body = {
            ...orderBody(),
            expectedVersion: order.version,
            reference: 'Updated reference',
          },
          r = await Promise.all([
            call('/orders/' + order.id, body, randomUUID(), 0, 'PATCH'),
            call('/orders/' + order.id, body, randomUUID(), 0, 'PATCH'),
          ]);
        assert.deepEqual(r.map((v) => v.status).sort(), [200, 409]);
        order = await (await call('/orders/' + order.id)).json();
        assert.equal(
          (
            await call(
              '/orders/' + order.id,
              {
                ...body,
                expectedVersion: order.version,
                lines: [{ variantId: randomUUID(), quantity: '1', unitCost: '5.00' }],
              },
              randomUUID(),
              0,
              'PATCH',
            )
          ).status,
          400,
        );
        assert.deepEqual(await (await call('/orders/' + order.id)).json(), order);
      },
    );
    await t.test('issue audit failure preserves draft and rolls back its request key', async () => {
      const trigger = 'purchasing_issue_fail_' + randomBytes(4).toString('hex'),
        key = randomUUID();
      try {
        await db.query(
          'CREATE FUNCTION "' +
            trigger +
            "\"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='purchasing.order_issued' THEN RAISE EXCEPTION 'issue audit fixture';END IF;RETURN NEW;END $$",
        );
        await db.query(
          'CREATE TRIGGER "' +
            trigger +
            '" BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION "' +
            trigger +
            '"()',
        );
        assert.equal(
          (await call('/orders/' + order.id + '/issue', { expectedVersion: order.version }, key))
            .status,
          500,
        );
        assert.deepEqual(await (await call('/orders/' + order.id)).json(), order);
        assert.equal(
          (
            await db.query('SELECT count(*)::int AS n FROM purchasing_requests WHERE key=$1', [key])
          )[0].n,
          0,
        );
      } finally {
        await db.query('DROP TRIGGER IF EXISTS "' + trigger + '" ON audit_events');
        await db.query('DROP FUNCTION "' + trigger + '"()');
      }
    });
    await t.test(
      'issue validates active suppliers/SKUs and freezes snapshots without changing stock',
      async () => {
        await db.query('UPDATE purchasing_suppliers SET is_active=false WHERE id=$1', [
          supplier.id,
        ]);
        assert.equal(
          (await call('/orders/' + order.id + '/issue', { expectedVersion: order.version })).status,
          400,
        );
        await db.query('UPDATE purchasing_suppliers SET is_active=true WHERE id=$1', [supplier.id]);
        const before = (await db.query('SELECT count(*)::int AS n FROM inventory_entries'))[0].n,
          key = randomUUID(),
          body = { expectedVersion: order.version };
        const r = await call('/orders/' + order.id + '/issue', body, key);
        assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
        order = await r.json();
        assert.equal(order.status, 'issued');
        assert.equal(order.supplierSnapshot.name, supplier.name);
        assert.equal(order.total, '300.30');
        assert.deepEqual(
          await (await call('/orders/' + order.id + '/issue', body, key)).json(),
          order,
        );
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM inventory_entries'))[0].n,
          before,
        );
        assert.equal(
          (
            await call(
              '/orders/' + order.id,
              { ...orderBody(), expectedVersion: order.version },
              randomUUID(),
              0,
              'PATCH',
            )
          ).status,
          409,
        );
        await db.query("UPDATE purchasing_suppliers SET name='Renamed master record' WHERE id=$1", [
          supplier.id,
        ]);
        await db.query("UPDATE catalog_products SET name='Renamed product' WHERE id=$1", [product]);
        const frozen = await (await call('/orders/' + order.id)).json();
        assert.equal(frozen.supplierName, supplier.name);
        assert.equal(frozen.lines[0].productName, 'Purchasing cotton tee');
      },
    );
    await t.test(
      'database itself refuses rewriting issued lines/header and deleting order history',
      async () => {
        const runtime = createRuntimeDataSource();
        await runtime.initialize();
        try {
          await assert.rejects(
            runtime.query('UPDATE purchase_order_lines SET unit_cost_minor=1 WHERE order_id=$1', [
              order.id,
            ]),
            /PURCHASING_ORDER_IMMUTABLE/,
          );
          await assert.rejects(
            runtime.query('DELETE FROM purchase_order_lines WHERE order_id=$1', [order.id]),
            /PURCHASING_ORDER_IMMUTABLE/,
          );
          await assert.rejects(
            runtime.query("UPDATE purchase_orders SET notes='Tampered' WHERE id=$1", [order.id]),
            /PURCHASING_ORDER_IMMUTABLE/,
          );
          await assert.rejects(
            runtime.query('DELETE FROM purchase_orders WHERE id=$1', [order.id]),
          );
          assert.equal(
            (
              await runtime.query(
                "SELECT has_table_privilege(current_user,'purchasing_requests','UPDATE') AS allowed",
              )
            )[0].allowed,
            false,
          );
        } finally {
          await runtime.destroy();
        }
      },
    );
    await t.test(
      'cancellation requires reason/version, preserves order and is retry-safe',
      async () => {
        assert.equal(
          (
            await call('/orders/' + order.id + '/cancel', {
              expectedVersion: order.version,
              reason: '',
            })
          ).status,
          400,
        );
        const body = {
            expectedVersion: order.version,
            reason: 'Supplier cannot fulfill the order',
          },
          key = randomUUID();
        const r = await call('/orders/' + order.id + '/cancel', body, key);
        assert.equal(r.status, 201);
        order = await r.json();
        assert.equal(order.status, 'cancelled');
        assert.equal(order.lines.length, 1);
        assert.deepEqual(
          await (await call('/orders/' + order.id + '/cancel', body, key)).json(),
          order,
        );
        assert.equal(
          (
            await call('/orders/' + order.id + '/cancel', {
              ...body,
              expectedVersion: order.version,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'audit failure rolls back supplier and save key; literal search remains bounded',
      async () => {
        const trigger = 'purchasing_fail_' + randomBytes(4).toString('hex'),
          key = randomUUID(),
          body = { ...supplierBody(), code: prefix + '-AUDIT' };
        try {
          await db.query(
            'CREATE FUNCTION "' +
              trigger +
              "\"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='purchasing.supplier_created' THEN RAISE EXCEPTION 'audit fixture';END IF;RETURN NEW;END $$",
          );
          await db.query(
            'CREATE TRIGGER "' +
              trigger +
              '" BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION "' +
              trigger +
              '"()',
          );
          assert.equal((await call('/suppliers', body, key)).status, 500);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM purchasing_suppliers WHERE code=$1', [
                body.code,
              ])
            )[0].n,
            0,
          );
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM purchasing_requests WHERE key=$1', [
                key,
              ])
            )[0].n,
            0,
          );
        } finally {
          await db.query('DROP TRIGGER IF EXISTS "' + trigger + '" ON audit_events');
          await db.query('DROP FUNCTION "' + trigger + '"()');
        }
        assert.equal((await call('/suppliers', body, key)).status, 201);
        const literal = await (await call('/suppliers?search=%25')).json();
        assert.equal(literal.total, 0);
        assert.equal((await call('/orders?page=10001')).status, 400);
      },
    );
    await t.test(
      'new migration reverts empty scratch schema and preserves prior stock foundation',
      async () => {
        const r = db.createQueryRunner(),
          schema = 'purchasing_probe_' + randomBytes(4).toString('hex');
        try {
          await r.startTransaction();
          await r.query('CREATE SCHEMA "' + schema + '"');
          await r.query('SET LOCAL search_path TO "' + schema + '",pg_catalog');
          for (const migration of [
            new IdentityFoundation1794096000000(),
            new CatalogFoundation1794100000000(),
            new ProductMedia1794101000000(),
            new OriginalMedia1794102000000(),
            new InventoryFoundation1794103000000(),
          ])
            await migration.up(r);
          const migration = new PurchasingFoundation1794104000000();
          await migration.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 6);
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 5);
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
      },
    );
  } finally {
    if (app) await app.close();
    try {
      if (ready)
        await db.transaction(async (m) => {
          await m.query('DELETE FROM purchasing_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM purchase_order_lines WHERE order_id IN(SELECT id FROM purchase_orders WHERE created_by=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM purchase_orders WHERE created_by=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM purchasing_suppliers WHERE code LIKE $1', [prefix + '%']);
          await m.query('DELETE FROM catalog_variants WHERE id=$1', [variant]);
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
