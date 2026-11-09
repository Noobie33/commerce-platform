import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createDataSource, databaseUrl } from '../src/infrastructure/database/data-source.js';
import { RetailOnly1794111000000 } from '../src/database/migrations/1794111000000-retail-only.js';

test('retail cutover upgrades schema 12 without rewriting legacy history, prices, holds or ACLs', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  const r = db.createQueryRunner(),
    schema = 'retail_upgrade_' + randomBytes(5).toString('hex'),
    s = '"' + schema + '"';
  const actor = randomUUID(),
    location = randomUUID(),
    product = randomUUID(),
    variant = randomUUID();
  const next = new RetailOnly1794111000000();
  const invoke = async (fn: string, payload: unknown, key = randomUUID()) =>
    (
      await r.query(`SELECT ${s}.${fn}($1,$2,$3,$4::jsonb) AS result`, [
        key,
        actor,
        randomUUID(),
        JSON.stringify(payload),
      ])
    )[0].result;
  const customerBody = (segment = 'retail') => ({
    kind: 'create',
    customerKind: 'person',
    segment,
    name: 'Upgrade fixture',
    contactName: '',
    phone: '',
    email: '',
    billingAddress: null,
    deliveryAddress: null,
    notes: '',
    isActive: true,
  });
  const customerKey = randomUUID(),
    creditKey = randomUUID(),
    orderKey = randomUUID(),
    tradeKey = randomUUID(),
    holdKey = randomUUID();
  let retail: { id: string; version: number },
    trade: { id: string; version: number },
    order: { id: string; version: number },
    tradeOrder: { id: string; version: number };
  const salesBody = (
    customer: { id: string; version: number },
    channel = 'retail',
    priceMode = 'catalog',
  ) => ({
    kind: 'create',
    customerId: customer.id,
    customerVersion: customer.version,
    locationId: location,
    channel,
    fulfillOn: null,
    reference: 'Upgrade fixture',
    notes: '',
    priceReason: priceMode === 'override' ? 'Historical quote' : '',
    lines: [
      {
        variantId: variant,
        quantity: '3',
        unitPrice: priceMode === 'override' ? '8000' : '10000',
        priceMode,
      },
    ],
  });
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of [
      'customers',
      'customer_credit_history',
      'customer_requests',
      'sales_orders',
      'sales_order_lines',
      'sales_requests',
      'sales_reservations',
      'sales_reservation_lines',
      'sales_reservation_state',
      'sales_reservation_requests',
      'inventory_postings',
      'inventory_entries',
      'inventory_balances',
      'audit_events',
    ])
      result[table] = await r.query(
        `SELECT to_jsonb(t) AS row FROM ${s}.${table} t ORDER BY to_jsonb(t)::text`,
      );
    return result;
  };
  const acl = async () =>
    r.query(
      `SELECT p.proname,p.proacl::text,p.prosecdef,p.proconfig,p.proowner::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname IN('customer_save','sales_draft_save','sales_reservation_post') ORDER BY p.proname`,
      [schema],
    );
  await r.connect();
  try {
    await r.query(`CREATE SCHEMA ${s}`);
    await r.query(`SET search_path TO ${s},public`);
    for (const migration of db.migrations) {
      if (migration instanceof RetailOnly1794111000000) break;
      await migration.up(r);
    }
    await r.query(
      `INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,'retail.fixture','Upgrade fixture','not-a-login-hash',false)`,
      [actor],
    );
    await r.query(
      `INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'`,
      [actor],
    );
    await r.query(`INSERT INTO locations(id,code,name) VALUES($1,'UPGRADE','Upgrade fixture')`, [
      location,
    ]);
    await r.query(
      `INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,'UPGRADE','Upgrade fixture','active')`,
      [product],
    );
    await r.query(
      `INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor) VALUES($1,$2,'UPGRADE-SKU',$3,10000)`,
      [variant, product, 'a'.repeat(64)],
    );
    retail = await invoke('customer_save', customerBody(), customerKey);
    trade = await invoke('customer_save', customerBody('wholesale'));
    const creditPayload = {
      kind: 'credit',
      id: trade.id,
      expectedVersion: trade.version,
      creditEnabled: true,
      creditLimit: '2500015',
      paymentTermsDays: 30,
      reason: 'Historical credit decision',
    };
    trade = await invoke('customer_save', creditPayload, creditKey);
    order = await invoke('sales_draft_save', salesBody(retail), orderKey);
    tradeOrder = await invoke(
      'sales_draft_save',
      salesBody(trade, 'wholesale', 'override'),
      tradeKey,
    );
    await invoke('inventory_post', {
      kind: 'receipt',
      locationId: location,
      destinationId: null,
      reason: 'Upgrade stock',
      reference: '',
      lines: [{ variantId: variant, quantity: '20' }],
    });
    const retailHoldPayload = {
      kind: 'hold',
      orderId: order.id,
      expectedVersion: order.version,
      expectedRevision: 1,
      holdMinutes: 30,
      reason: 'Retail hold',
    };
    const held = await invoke('sales_reservation_post', retailHoldPayload, holdKey);
    const tradeHoldPayload = {
      kind: 'hold',
      orderId: tradeOrder.id,
      expectedVersion: tradeOrder.version,
      expectedRevision: 1,
      holdMinutes: 30,
      reason: 'Legacy trade hold',
    };
    const tradeHoldKey = randomUUID(),
      tradeHeld = await invoke('sales_reservation_post', tradeHoldPayload, tradeHoldKey);
    const before = await snapshot(),
      grants = await acl(),
      availability = await r.query(
        'SELECT on_hand::text,reserved::text,available::text FROM inventory_availability',
      );
    await next.up(r);
    await t.test(
      'forward migration preserves every historical row and function security boundary',
      async () => {
        assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 13);
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await acl(), grants);
        assert.deepEqual(
          await r.query(
            'SELECT on_hand::text,reserved::text,available::text FROM inventory_availability',
          ),
          availability,
        );
        await assert.rejects(next.down(r), /Cannot re-enable/);
      },
    );
    await t.test(
      'legacy writes and cached trade replays cannot reactivate retired behavior',
      async () => {
        await assert.rejects(invoke('customer_save', customerBody('both')), /CUSTOMER_RETAIL_ONLY/);
        await assert.rejects(
          invoke('customer_save', creditPayload, creditKey),
          /CUSTOMER_RETAIL_ONLY/,
        );
        await assert.rejects(
          invoke('sales_draft_save', salesBody(trade, 'wholesale', 'override'), tradeKey),
          /SALES_RETAIL_ONLY/,
        );
        await assert.rejects(
          invoke('sales_draft_save', salesBody(retail, 'retail', 'override')),
          /SALES_RETAIL_ONLY/,
        );
        await assert.rejects(
          invoke('sales_reservation_post', tradeHoldPayload, tradeHoldKey),
          /RESERVATION_RETAIL_ONLY/,
        );
        await assert.rejects(
          invoke('customer_save', {
            ...customerBody(),
            kind: 'update',
            id: trade.id,
            expectedVersion: trade.version,
          }),
          /CUSTOMER_RETAIL_ONLY/,
        );
        await assert.rejects(
          invoke('sales_draft_save', {
            ...salesBody(retail),
            kind: 'update',
            id: tradeOrder.id,
            expectedVersion: 2,
          }),
          /SALES_RETAIL_ONLY/,
        );
        assert.deepEqual(await snapshot(), before);
      },
    );
    await t.test(
      'valid retail retries preserve identity and still require current authorization',
      async () => {
        assert.deepEqual(await invoke('customer_save', customerBody(), customerKey), retail);
        assert.deepEqual(await invoke('sales_draft_save', salesBody(retail), orderKey), order);
        assert.deepEqual(await invoke('sales_reservation_post', retailHoldPayload, holdKey), held);
        await r.query("DELETE FROM role_permissions WHERE permission_code='sales.reserve'");
        await assert.rejects(
          invoke('sales_reservation_post', retailHoldPayload, holdKey),
          /RESERVATION_PERMISSION/,
        );
        await r.query(
          "INSERT INTO role_permissions(role_id,permission_code) SELECT id,'sales.reserve' FROM roles WHERE code='owner'",
        );
        assert.deepEqual(await snapshot(), before);
      },
    );
    await t.test(
      'legacy commitments can be released and cancelled without changing quoted amounts',
      async () => {
        const current = (
          await r.query('SELECT version FROM sales_orders WHERE id=$1', [tradeOrder.id])
        )[0];
        const released = await invoke('sales_reservation_post', {
          kind: 'release',
          orderId: tradeOrder.id,
          reservationId: tradeHeld.id,
          expectedVersion: current.version,
          expectedRevision: 2,
          reason: 'Retire old trade draft',
        });
        const after = (
          await r.query('SELECT version FROM sales_orders WHERE id=$1', [tradeOrder.id])
        )[0];
        assert(released);
        await invoke('sales_draft_save', {
          kind: 'cancel',
          id: tradeOrder.id,
          expectedVersion: after.version,
          reason: 'Retired trade workflow',
        });
        const legacy = (
          await r.query('SELECT channel,status,total_minor::text FROM sales_orders WHERE id=$1', [
            tradeOrder.id,
          ])
        )[0];
        assert.deepEqual(legacy, {
          channel: 'wholesale',
          status: 'cancelled',
          total_minor: '24000',
        });
        assert.equal(
          (await r.query('SELECT available::text FROM inventory_availability'))[0].available,
          '17',
        );
        assert.equal(
          (await r.query('SELECT count(*)::int AS n FROM customer_credit_history'))[0].n,
          1,
        );
      },
    );
  } finally {
    await r.query('SET search_path TO public');
    await r.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await r.release();
    await db.destroy();
  }
});

test('retail policy safely reverts and reapplies on an empty scratch schema', async () => {
  const db = createDataSource();
  await db.initialize();
  const r = db.createQueryRunner(),
    schema = 'retail_empty_' + randomBytes(5).toString('hex');
  await r.connect();
  try {
    await r.query('CREATE SCHEMA ' + schema);
    await r.query('SET search_path TO ' + schema + ',public');
    for (const migration of db.migrations) {
      await migration.up(r);
      if (migration instanceof RetailOnly1794111000000) break;
    }
    const next = new RetailOnly1794111000000();
    await next.down(r);
    assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 12);
    await next.up(r);
    assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 13);
  } finally {
    await r.query('SET search_path TO public');
    await r.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await r.release();
    await db.destroy();
  }
});
