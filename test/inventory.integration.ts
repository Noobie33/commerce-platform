import { IdentityFoundation1794096000000 } from '../src/database/migrations/1794096000000-identity-foundation.js';
import { CatalogFoundation1794100000000 } from '../src/database/migrations/1794100000000-catalog-foundation.js';
import { ProductMedia1794101000000 } from '../src/database/migrations/1794101000000-product-media.js';
import { OriginalMedia1794102000000 } from '../src/database/migrations/1794102000000-original-media.js';
import { InventoryFoundation1794103000000 } from '../src/database/migrations/1794103000000-inventory-foundation.js';
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
import type { StockPosting } from '../src/modules/inventory/inventory.types.js';

test('inventory: real PostgreSQL posting, location permissions and immutable corrections', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  const prefix = 'INV' + randomBytes(5).toString('hex').toUpperCase();
  const users = [randomUUID(), randomUUID(), randomUUID()],
    names = users.map((_, i) => (prefix + i).toLowerCase()),
    role = randomUUID();
  const locations = [randomUUID(), randomUUID()],
    product = randomUUID(),
    variants = [randomUUID(), randomUUID()];
  const buckets = [
    ...names.map((n) => tokenHash('user:' + n)),
    ...['ip:127.0.0.1', 'ip:::ffff:127.0.0.1'].map(tokenHash),
  ];
  const requests: string[] = [];
  const origin = 'http://inventory.test';
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
  async function call(path: string, body?: unknown, key = randomUUID(), who = 0) {
    const r = await fetch(base + '/api/v1/inventory' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers(sessions[who]!), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const id = r.headers.get('x-request-id');
    if (id) requests.push(id);
    return r;
  }
  const input = (
    kind = 'receipt',
    quantity = '10',
    variant = variants[0]!,
    location = locations[0]!,
  ) => ({
    kind,
    locationId: location,
    destinationId: kind === 'transfer' ? locations[1] : null,
    reason: 'Integration stock fixture',
    reference: prefix,
    lines: [{ variantId: variant, quantity }],
  });
  const balance = async (loc = locations[0]!, variant = variants[0]!) =>
    (
      await db.query(
        'SELECT quantity::text AS quantity FROM inventory_balances WHERE location_id=$1 AND variant_id=$2',
        [loc, variant],
      )
    )[0]?.quantity ?? '0';
  async function saved(body: unknown): Promise<StockPosting> {
    const r = await call('/postings', body);
    assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
    return r.json();
  }
  try {
    await db.runMigrations();
    await grantRuntime(db, process.env);
    ready = true;
    await db.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [buckets]);
    const password = 'Inventory integration password 2026!',
      hash = await new PasswordService().hash(password);
    for (let i = 0; i < users.length; i++)
      await db.query(
        'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,$3,$4,false)',
        [users[i], names[i], 'Inventory fixture', hash],
      );
    await db.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [users[0]],
    );
    await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [role, prefix]);
    await db.query(
      "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'inventory.read'),($1,'inventory.receive'),($1,'inventory.adjust'),($1,'inventory.transfer')",
      [role],
    );
    for (let i = 0; i < locations.length; i++)
      await db.query('INSERT INTO locations(id,code,name,kind) VALUES($1,$2,$3,$4)', [
        locations[i],
        prefix + i,
        'Inventory location ' + i,
        i ? 'store' : 'warehouse',
      ]);
    await db.query(
      'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
      [users[1], role, locations[0]],
    );
    await db.query(
      "INSERT INTO catalog_products(id,style_code,name,status,currency) VALUES($1,$2,'Inventory cotton tee','active','BDT')",
      [product, prefix],
    );
    for (let i = 0; i < variants.length; i++)
      await db.query(
        'INSERT INTO catalog_variants(id,product_id,sku,attributes,options_key,price_minor,is_active) VALUES($1,$2,$3,$4::jsonb,$5,10000,true)',
        [
          variants[i],
          product,
          prefix + '-' + i,
          JSON.stringify({ size: i ? 'L' : 'M' }),
          String(i).repeat(64),
        ],
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
    await t.test('default deny, location scopes and CSRF are enforced', async () => {
      assert.equal((await call('/locations', undefined, randomUUID(), 2)).status, 403);
      const scoped = await (await call('/locations', undefined, randomUUID(), 1)).json();
      assert.deepEqual(
        scoped.map((r: { id: string }) => r.id),
        [locations[0]],
      );
      assert.equal(
        (await call('/locations/' + locations[1] + '/stock', undefined, randomUUID(), 1)).status,
        403,
      );
      assert.equal((await call('/postings', input('transfer', '1'), randomUUID(), 1)).status, 403);
      const r = await fetch(base + '/api/v1/inventory/postings', {
        method: 'POST',
        headers: { ...headers(sessions[0]!), 'X-CSRF-Token': '' },
        body: JSON.stringify(input()),
      });
      assert.equal(r.status, 403);
    });
    let opening: StockPosting;
    await t.test(
      'concurrent identical retries post exactly once and changed requests conflict',
      async () => {
        const key = randomUUID(),
          body = input('opening', '10');
        const results = await Promise.all([
          call('/postings', body, key),
          call('/postings', body, key),
        ]);
        assert.deepEqual(
          results.map((r) => r.status),
          [201, 201],
        );
        opening = await results[0]!.json();
        assert.deepEqual(await results[1]!.json(), opening);
        assert.equal(await balance(), '10');
        assert.equal(
          (
            await db.query('SELECT count(*)::int AS n FROM inventory_postings WHERE id=$1', [
              opening.id,
            ])
          )[0].n,
          1,
        );
        assert.equal((await call('/postings', input('opening', '11'), key)).status, 409);
        assert.equal((await call('/postings', input('opening', '1'))).status, 409);
      },
    );
    await t.test(
      'concurrent deductions cannot oversell and failed multi-line posts roll back',
      async () => {
        const r = await Promise.all([
          call('/postings', input('adjustment', '-7')),
          call('/postings', input('adjustment', '-7')),
        ]);
        assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
        assert.equal(await balance(), '3');
        const body = input('receipt', '5');
        body.lines.push({ variantId: randomUUID(), quantity: '2' });
        assert.equal((await call('/postings', body)).status, 404);
        assert.equal(await balance(), '3');
        assert.equal((await call('/postings', { ...input(), lines: [] })).status, 400);
        assert.equal((await call('/postings', input('receipt', '1.5'))).status, 400);
      },
    );
    await t.test(
      'transfers conserve quantity, require both locations and reverse through new entries',
      async () => {
        const transfer = await saved(input('transfer', '2'));
        assert.equal(transfer.lines.length, 2);
        assert.equal(
          (await call('/postings/' + transfer.id + '/reversal-preview', undefined, randomUUID(), 1))
            .status,
          403,
        );
        const preview = await call('/postings/' + transfer.id + '/reversal-preview');
        assert.equal(preview.status, 200);
        const previewLines = await preview.json();
        assert.equal(previewLines.length, 2);
        assert.deepEqual(
          new Set(previewLines.map((l: { locationId: string }) => l.locationId)),
          new Set(locations),
        );
        assert.equal(
          transfer.lines.reduce((s, l) => s + BigInt(l.delta), 0n),
          0n,
        );
        assert.equal(await balance(), '1');
        assert.equal(await balance(locations[1]), '2');
        const reason = { reason: 'Correct transfer entered in error', reference: prefix },
          key = randomUUID();
        const reversed = await call('/postings/' + transfer.id + '/reverse', reason, key);
        assert.equal(reversed.status, 201);
        const reversal: StockPosting = await reversed.json();
        assert.equal(reversal.reversalOf, transfer.id);
        assert.equal(await balance(), '3');
        assert.equal(await balance(locations[1]), '0');
        assert.deepEqual(
          await (await call('/postings/' + transfer.id + '/reverse', reason, key)).json(),
          reversal,
        );
        assert.equal((await call('/postings/' + transfer.id + '/reverse', reason)).status, 409);
        assert.equal((await call('/postings/' + reversal.id + '/reverse', reason)).status, 409);
        const history = await (await call('/locations/' + locations[0] + '/history')).json();
        assert.equal(
          history.items.find((r: { id: string }) => r.id === transfer.id).reversedBy,
          reversal.id,
        );
      },
    );
    await t.test(
      'inactive variants cannot receive new stock; physical corrections remain possible',
      async () => {
        await db.query('UPDATE catalog_variants SET is_active=false WHERE id=$1', [variants[0]]);
        assert.equal((await call('/postings', input())).status, 409);
        await saved(input('adjustment', '-1'));
        assert.equal(await balance(), '2');
        await db.query('UPDATE catalog_variants SET is_active=true WHERE id=$1', [variants[0]]);
      },
    );
    await t.test('audit failure rolls back balances, ledger and retry key together', async () => {
      const trigger = 'inventory_fail_' + randomBytes(4).toString('hex'),
        key = randomUUID(),
        body = input('receipt', '4');
      try {
        await db.query(
          'CREATE FUNCTION "' +
            trigger +
            "\"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='inventory.posted' THEN RAISE EXCEPTION 'inventory audit test'; END IF; RETURN NEW; END $$",
        );
        await db.query(
          'CREATE TRIGGER "' +
            trigger +
            '" BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION "' +
            trigger +
            '"()',
        );
        assert.equal((await call('/postings', body, key)).status, 500);
        assert.equal(await balance(), '2');
        assert.equal(
          (
            await db.query('SELECT count(*)::int AS n FROM inventory_requests WHERE key=$1', [key])
          )[0].n,
          0,
        );
      } finally {
        await db.query('DROP TRIGGER IF EXISTS "' + trigger + '" ON audit_events');
        await db.query('DROP FUNCTION "' + trigger + '"()');
      }
      assert.equal((await call('/postings', body, key)).status, 201);
      assert.equal(await balance(), '6');
    });
    await t.test('runtime database role cannot write balances or history directly', async () => {
      const runtime = createRuntimeDataSource();
      await runtime.initialize();
      try {
        for (const table of [
          'inventory_balances',
          'inventory_entries',
          'inventory_postings',
          'inventory_requests',
        ]) {
          for (const action of ['INSERT', 'UPDATE', 'DELETE'])
            assert.equal(
              (
                await runtime.query('SELECT has_table_privilege(current_user,$1,$2) AS allowed', [
                  table,
                  action,
                ])
              )[0].allowed,
              false,
            );
        }
        await assert.rejects(
          runtime.query('UPDATE inventory_balances SET quantity=0 WHERE location_id=$1', [
            locations[0],
          ]),
        );
      } finally {
        await runtime.destroy();
      }
    });
    await t.test(
      'failed transfer reversal and multi-SKU transfer change neither location',
      async () => {
        await saved(input('receipt', '2', variants[1]));
        const transfer = await saved(input('transfer', '2', variants[1]));
        await saved(input('adjustment', '-1', variants[1], locations[1]));
        assert.equal(
          (
            await call('/postings/' + transfer.id + '/reverse', {
              reason: 'Cannot return consumed pieces',
              reference: prefix,
            })
          ).status,
          409,
        );
        assert.equal(await balance(locations[0], variants[1]), '0');
        assert.equal(await balance(locations[1], variants[1]), '1');
        await saved(input('receipt', '1', variants[1], locations[1]));
        assert.equal(
          (
            await call('/postings/' + transfer.id + '/reverse', {
              reason: 'Pieces restored for correction',
              reference: prefix,
            })
          ).status,
          201,
        );
        await saved(input('adjustment', '-2', variants[1]));
        const before = await balance(),
          body = input('transfer', '1');
        body.lines.push({ variantId: variants[1]!, quantity: '1' });
        assert.equal((await call('/postings', body)).status, 409);
        assert.equal(await balance(), before);
        assert.equal(await balance(locations[1]), '0');
        assert.equal((await call('/postings', input('opening', '1', variants[1]))).status, 409);
      },
    );
    await t.test('location creation is globally restricted, unique and audited', async () => {
      const body = { code: prefix + '-NEW', name: 'Additional test warehouse', kind: 'warehouse' };
      assert.equal((await call('/locations', body, randomUUID(), 1)).status, 403);
      const result = await call('/locations', body);
      assert.equal(result.status, 201);
      const created = await result.json();
      locations.push(created.id);
      assert.equal((await call('/locations', body)).status, 409);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM audit_events WHERE actor_id=$1 AND action='inventory.location_created' AND metadata->>'locationId'=$2",
            [users[0], created.id],
          )
        )[0].n,
        1,
      );
    });
    await t.test('revoked write permissions block even a previously cached retry', async () => {
      const key = randomUUID(),
        body = input('receipt', '1', variants[1]);
      assert.equal((await call('/postings', body, key, 1)).status, 201);
      await db.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='inventory.receive'",
        [role],
      );
      assert.equal((await call('/postings', body, key, 1)).status, 403);
    });
    await t.test(
      'migration isolates its functions, reverts empty schema and refuses deleting posted history',
      async () => {
        const r = db.createQueryRunner(),
          schema = 'inventory_probe_' + randomBytes(4).toString('hex');
        const before = await balance();
        try {
          await r.startTransaction();
          await r.query('CREATE SCHEMA "' + schema + '"');
          await r.query('SET LOCAL search_path TO "' + schema + '",pg_catalog');
          await new IdentityFoundation1794096000000().up(r);
          await new CatalogFoundation1794100000000().up(r);
          await new ProductMedia1794101000000().up(r);
          await new OriginalMedia1794102000000().up(r);
          const migration = new InventoryFoundation1794103000000();
          await migration.up(r);
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 4);
          await migration.up(r);
          await r.query('INSERT INTO staff_users SELECT * FROM public.staff_users WHERE id=$1', [
            users[0],
          ]);
          await r.query(
            "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
            [users[0]],
          );
          await r.query('INSERT INTO locations SELECT * FROM public.locations WHERE id=$1', [
            locations[0],
          ]);
          await r.query(
            'INSERT INTO catalog_products SELECT * FROM public.catalog_products WHERE id=$1',
            [product],
          );
          await r.query(
            'INSERT INTO catalog_variants SELECT * FROM public.catalog_variants WHERE product_id=$1',
            [product],
          );
          const result = await r.query(
            'SELECT "' + schema + '".inventory_post($1,$2,$3,$4::jsonb) AS result',
            [randomUUID(), users[0], randomUUID(), JSON.stringify(input('opening', '3'))],
          );
          assert.equal(result[0].result.lines[0].quantityAfter, '3');
          assert.equal(
            (
              await r.query(
                'SELECT quantity::text AS n FROM inventory_balances WHERE variant_id=$1',
                [variants[0]],
              )
            )[0].n,
            '3',
          );
          await assert.rejects(migration.down(r), /Cannot drop posted inventory history/);
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
        assert.equal(await balance(), before);
      },
    );
    await t.test('all materialized balances reconcile to immutable movement sums', async () => {
      const rows = await db.query(
        'SELECT b.quantity::text AS balance,coalesce(sum(e.delta),0)::text AS ledger FROM inventory_balances b LEFT JOIN inventory_entries e USING(location_id,variant_id) WHERE b.location_id=ANY($1::uuid[]) GROUP BY b.location_id,b.variant_id,b.quantity',
        [locations],
      );
      for (const row of rows) assert.equal(row.balance, row.ledger);
      const page = await (
        await call('/locations/' + locations[0] + '/stock?stock=positive')
      ).json();
      assert.equal(page.summary.units, '7');
      assert.equal(page.total, 2);
      const scoped = await (
        await call('/locations/' + locations[0] + '/history', undefined, randomUUID(), 1)
      ).json();
      for (const row of scoped.items) {
        assert.equal('destinationId' in row, false);
        assert.ok(row.lines.every((l: { locationId?: string }) => !l.locationId));
      }
    });
  } finally {
    if (app) await app.close();
    try {
      if (ready)
        await db.transaction(async (m) => {
          await m.query('DELETE FROM inventory_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM inventory_entries WHERE location_id=ANY($1::uuid[])', [
            locations,
          ]);
          await m.query('DELETE FROM inventory_balances WHERE location_id=ANY($1::uuid[])', [
            locations,
          ]);
          await m.query('DELETE FROM inventory_postings WHERE actor_id=ANY($1::uuid[])', [users]);
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
          await m.query('DELETE FROM role_permissions WHERE role_id=$1', [role]);
          await m.query('DELETE FROM roles WHERE id=$1', [role]);
          await m.query('DELETE FROM locations WHERE id=ANY($1::uuid[])', [locations]);
          await m.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
            buckets,
          ]);
        });
    } finally {
      await db.destroy();
    }
  }
});
