import { SupplierInvoices1794106000000 } from '../src/database/migrations/1794106000000-supplier-invoices.js';
import type { InvoicePage, InvoiceResult } from '../src/modules/purchasing/invoice.types.js';
import { PurchaseReceipts1794105000000 } from '../src/database/migrations/1794105000000-purchase-receipts.js';
import type { ReceivingPage, ReceiptResult } from '../src/modules/purchasing/receipt.types.js';
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
test('supplier invoices: matched quantities, exact amounts, immutable records and safe reversals', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  const prefix = 'INV' + randomBytes(5).toString('hex').toUpperCase(),
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
    lines: [{ variantId: variant, quantity: '100', unitCost: '100.10' }],
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

    const supplierResponse = await call('/suppliers', supplierBody());
    assert.equal(supplierResponse.status, 201);
    supplier = await supplierResponse.json();
    const draftResponse = await call('/orders', orderBody());
    assert.equal(draftResponse.status, 201);
    order = await draftResponse.json();
    const issued = await call('/orders/' + order.id + '/issue', { expectedVersion: order.version });
    assert.equal(issued.status, 201);
    order = await issued.json();

    async function payable(path: string, body?: unknown, key = randomUUID(), who = 0) {
      const r = await fetch(base + '/api/v1/payables' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...headers(sessions[who]!), 'X-Idempotency-Key': key },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const request = r.headers.get('x-request-id');
      if (request) requests.push(request);
      return r;
    }
    async function state(id = order.id): Promise<InvoicePage> {
      const r = await payable('/orders/' + id);
      assert.equal(r.status, 200);
      return r.json();
    }
    const receiving: ReceivingPage = await (
      await call('/orders/' + order.id + '/receiving')
    ).json();
    const receiptResponse = await call('/orders/' + order.id + '/receipts', {
      expectedRevision: 1,
      reason: 'Counted physical delivery',
      reference: 'DN-' + prefix,
      lines: [{ orderLineId: receiving.lines[0]!.id, quantity: '40' }],
    });
    assert.equal(receiptResponse.status, 201);
    const receipt: ReceiptResult = await receiptResponse.json();
    const balance = async () =>
      (
        await db.query(
          'SELECT quantity::text AS n FROM inventory_balances WHERE location_id=$1 AND variant_id=$2',
          [location, variant],
        )
      )[0]?.n;
    let invoiceState = await state();
    const firstLine = invoiceState.lines[0]!;
    const input = (
      quantity: string,
      revision = invoiceState.invoiceRevision,
      number = 'BILL-' + prefix,
    ) => ({
      expectedRevision: revision,
      number,
      invoiceOn: '2026-11-01',
      dueOn: '2026-12-01',
      tax: '10.02',
      delivery: '3.01',
      discount: '2.01',
      reason: 'Match supplier invoice to physical receipt',
      lines: [
        {
          receiptId: firstLine.receiptId,
          orderLineId: firstLine.orderLineId,
          quantity,
          unitCost: '100.11',
        },
      ],
    });
    let first: InvoiceResult, second: InvoiceResult;
    await t.test(
      'global commercial read and independent invoice action grants; read-only and CSRF denial',
      async () => {
        assert.equal(
          (await payable('/orders/' + order.id, undefined, randomUUID(), 1)).status,
          403,
        );
        await db.query(
          "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'payables.read'),($2,'payables.read'),($2,'payables.manage')",
          roles,
        );
        assert.equal(
          (await payable('/orders/' + order.id, undefined, randomUUID(), 1)).status,
          200,
        );
        assert.equal(
          (await payable('/orders/' + order.id, undefined, randomUUID(), 2)).status,
          403,
        );
        assert.equal(
          (await payable('/orders/' + order.id + '/invoices', input('1'), randomUUID(), 1)).status,
          403,
        );
        const denied = await fetch(base + '/api/v1/payables/orders/' + order.id + '/invoices', {
          method: 'POST',
          headers: {
            ...headers(sessions[0]!),
            'X-CSRF-Token': 'bad',
            'X-Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify(input('1')),
        });
        assert.equal(denied.status, 403);
      },
    );
    await t.test(
      'identical concurrent retries post one partial invoice with exact totals and unchanged stock',
      async () => {
        const key = randomUUID(),
          body = input('25'),
          responses = await Promise.all([
            payable('/orders/' + order.id + '/invoices', body, key),
            payable('/orders/' + order.id + '/invoices', body, key),
          ]);
        assert.deepEqual(
          responses.map((r) => r.status),
          [201, 201],
        );
        first = await responses[0]!.json();
        assert.deepEqual(await responses[1]!.json(), first);
        invoiceState = await state();
        assert.equal(invoiceState.total, 1);
        assert.equal(invoiceState.items[0]!.goods, '2502.75');
        assert.equal(invoiceState.items[0]!.total, '2513.77');
        assert.equal(invoiceState.unsettled, '2513.77');
        assert.equal(invoiceState.lines[0]!.remaining, '15');
        assert.equal(await balance(), '40');
        assert.equal(
          (await payable('/orders/' + order.id + '/invoices', { ...body, reason: 'Changed' }, key))
            .status,
          409,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE action='payables.invoice_posted' AND metadata->>'entityId'=$1",
              [first.invoiceId],
            )
          )[0].n,
          1,
        );
      },
    );
    await t.test(
      'different concurrent keys cannot both consume a stale allocation revision',
      async () => {
        const results = await Promise.all([
          payable('/orders/' + order.id + '/invoices', input('5', 2, 'NEXT-A-' + prefix)),
          payable('/orders/' + order.id + '/invoices', input('5', 2, 'NEXT-B-' + prefix)),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        second = await results.find((r) => r.status === 201)!.json();
        invoiceState = await state();
        assert.equal(invoiceState.invoiceRevision, 3);
        assert.equal(invoiceState.lines[0]!.remaining, '10');
      },
    );
    await t.test(
      'over-invoicing, duplicate lines, mass assignment, invalid dates and unsafe money are rejected',
      async () => {
        assert.equal((await payable('/orders/' + order.id + '/invoices', input('11'))).status, 409);
        const b = input('1');
        for (const body of [
          { ...b, lines: [b.lines[0], b.lines[0]] },
          { ...b, total: '1.00' },
          { ...b, tax: 0.1 },
          { ...b, invoiceOn: '2026-02-30' },
          { ...b, dueOn: '2026-01-01' },
          { ...b, discount: '999999.00' },
          { ...b, lines: [{ ...b.lines[0], unitCost: '1e3' }] },
        ])
          assert.equal((await payable('/orders/' + order.id + '/invoices', body)).status, 400);
        assert.equal(
          (
            await payable('/orders/' + order.id + '/invoices', {
              ...b,
              lines: [{ ...b.lines[0], receiptId: randomUUID() }],
            })
          ).status,
          409,
        );
        assert.equal(
          (await payable('/orders/' + order.id + '/invoices', input('1', 3, 'bill-' + prefix)))
            .status,
          409,
        );
        assert.equal((await state()).total, 2);
      },
    );
    await t.test(
      'invoiced receipts cannot reverse; failed reversal leaves stock and receiving revision unchanged',
      async () => {
        const r = await call('/receipts/' + receipt.receiptId + '/reverse', {
          expectedRevision: 2,
          reason: 'Should be blocked',
          reference: '',
        });
        assert.equal(r.status, 409);
        assert.equal((await r.json()).code, 'RECEIPT_INVOICED');
        assert.equal(await balance(), '40');
        const receiving: ReceivingPage = await (
          await call('/orders/' + order.id + '/receiving')
        ).json();
        assert.equal(receiving.receiptRevision, 2);
        assert.equal(receiving.items[0]!.invoiced, true);
        assert.equal(receiving.items[0]!.canReverse, false);
        assert.equal(receiving.lines[0]!.received, '40');
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM purchase_receipt_reversals WHERE receipt_id=$1',
              [receipt.receiptId],
            )
          )[0].n,
          0,
        );
      },
    );
    await t.test(
      'restricted SQL cannot rewrite invoice history or allocations; posting revalidates bounds',
      async () => {
        const runtime = createRuntimeDataSource();
        await runtime.initialize();
        try {
          for (const table of [
            'supplier_invoices',
            'supplier_invoice_lines',
            'supplier_invoice_state',
          ])
            for (const privilege of ['INSERT', 'UPDATE', 'DELETE'])
              assert.equal(
                (
                  await runtime.query('SELECT has_table_privilege(current_user,$1,$2) AS allowed', [
                    table,
                    privilege,
                  ])
                )[0].allowed,
                false,
              );
          await assert.rejects(
            runtime.query('UPDATE supplier_invoices SET total_minor=1 WHERE id=$1', [
              first.invoiceId,
            ]),
          );
          const b = input('11');
          await assert.rejects(
            runtime.query('SELECT public.supplier_invoice_post($1,$2,$3,$4::jsonb)', [
              randomUUID(),
              users[0],
              randomUUID(),
              JSON.stringify({
                kind: 'post',
                orderId: order.id,
                ...b,
                tax: '1002',
                delivery: '301',
                discount: '201',
                lines: b.lines.map((l) => ({ ...l, unitCost: '10011' })),
              }),
            ]),
            /INVOICE_OVER_QUANTITY/,
          );
        } finally {
          await runtime.destroy();
        }
      },
    );
    await t.test(
      'invoice audit failure rolls back document, allocations, revision and retry key',
      async () => {
        const name = 'fail_invoice_' + prefix.toLowerCase(),
          key = randomUUID(),
          body = input('1', 3, 'ROLLBACK-' + prefix);
        await db.query(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action='payables.invoice_posted' THEN RAISE EXCEPTION 'Intentional invoice audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
        try {
          assert.equal((await payable('/orders/' + order.id + '/invoices', body, key)).status, 500);
          assert.equal((await state()).total, 2);
          assert.equal((await state()).invoiceRevision, 3);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM purchasing_requests WHERE key=$1', [
                key,
              ])
            )[0].n,
            0,
          );
        } finally {
          await db.query(`DROP TRIGGER ${name} ON audit_events;DROP FUNCTION ${name}()`);
        }
        assert.equal((await payable('/orders/' + order.id + '/invoices', body, key)).status, 201);
        invoiceState = await state();
        assert.equal(invoiceState.lines[0]!.remaining, '9');
      },
    );
    await t.test(
      'reversal is audited, preserves prices and stock, releases quantities and permits corrected supplier number',
      async () => {
        const key = randomUUID(),
          body = { expectedRevision: 4, reason: 'Incorrect unit price on entered invoice' };
        const results = await Promise.all([
          payable('/invoices/' + first.invoiceId + '/reverse', body, key),
          payable('/invoices/' + first.invoiceId + '/reverse', body, key),
        ]);
        assert.deepEqual(
          results.map((r) => r.status),
          [201, 201],
        );
        invoiceState = await state();
        assert.equal(invoiceState.invoiceRevision, 5);
        assert.equal(invoiceState.lines[0]!.remaining, '34');
        assert.ok(invoiceState.items.find((i) => i.id === first.invoiceId)!.reversedAt);
        assert.equal(invoiceState.items.find((i) => i.id === first.invoiceId)!.total, '2513.77');
        assert.equal(await balance(), '40');
        assert.equal(
          (await payable('/orders/' + order.id + '/invoices', input('1', 5, 'BILL-' + prefix)))
            .status,
          201,
        );
        invoiceState = await state();
        assert.equal(
          (
            await payable('/invoices/' + first.invoiceId + '/reverse', {
              expectedRevision: 6,
              reason: 'Repeated reversal',
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'revoked global permission blocks cached invoice retry without changing the saved invoice',
      async () => {
        await db.query(
          "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'payables.manage')",
          [roles[0]],
        );
        const key = randomUUID(),
          body = input('1', 6, 'REVOKE-' + prefix);
        assert.equal(
          (await payable('/orders/' + order.id + '/invoices', body, key, 1)).status,
          201,
        );
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='payables.manage'",
          [roles[0]],
        );
        assert.equal(
          (await payable('/orders/' + order.id + '/invoices', body, key, 1)).status,
          403,
        );
        invoiceState = await state();
        assert.equal(invoiceState.invoiceRevision, 7);
      },
    );
    await t.test(
      'invoice list/search totals are exact and bounded, with inactive supplier snapshots preserved',
      async () => {
        await db.query('UPDATE purchasing_suppliers SET name=$1,is_active=false WHERE id=$2', [
          'Changed supplier name',
          supplier.id,
        ]);
        const list = await payable(
          '/invoices?search=' + encodeURIComponent(prefix) + '&status=active&page=1',
        );
        assert.equal(list.status, 200);
        const body = await list.json();
        assert.equal(body.total, 4);
        assert.equal(body.items[0].supplierName, 'QA clothing supplier');
        assert.equal(body.unsettled, (await state()).unsettled);
        assert.equal((await (await payable('/invoices?search=%25')).json()).total, 0);
        assert.equal((await payable('/invoices?page=0')).status, 400);
        assert.equal((await payable('/invoices?status=paid')).status, 400);
      },
    );
    await t.test(
      'concurrent invoice and receipt reversal share the PO lock and cannot both succeed',
      async () => {
        const added = await call('/orders/' + order.id + '/receipts', {
          expectedRevision: 2,
          reason: 'Additional delivery for concurrency check',
          reference: 'RACE-' + prefix,
          lines: [{ orderLineId: firstLine.orderLineId, quantity: '10' }],
        });
        assert.equal(added.status, 201);
        const extra: ReceiptResult = await added.json(),
          snapshot = await state(),
          line = snapshot.lines.find((l) => l.receiptId === extra.receiptId)!;
        const body = {
          ...input('1', snapshot.invoiceRevision, 'RACE-' + prefix),
          lines: [
            {
              receiptId: line.receiptId,
              orderLineId: line.orderLineId,
              quantity: '1',
              unitCost: '100.00',
            },
          ],
        };
        const results = await Promise.all([
          payable('/orders/' + order.id + '/invoices', body),
          call('/receipts/' + extra.receiptId + '/reverse', {
            expectedRevision: 3,
            reason: 'Delivery count correction',
            reference: '',
          }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.id=l.invoice_id JOIN purchase_receipt_reversals r ON r.receipt_id=l.receipt_id WHERE i.reversed_at IS NULL AND i.order_id=$1',
              [order.id],
            )
          )[0].n,
          0,
        );
      },
    );
    await t.test(
      'compiled migration refuses discarding invoice history and reverts an empty scratch schema',
      async () => {
        const live = db.createQueryRunner();
        await live.connect();
        try {
          await assert.rejects(new SupplierInvoices1794106000000().down(live), /Cannot discard/);
        } finally {
          await live.release();
        }
        const schema = 'invoice_scratch_' + prefix.toLowerCase(),
          r = db.createQueryRunner();
        await r.connect();
        try {
          await r.query('CREATE SCHEMA "' + schema + '"');
          await r.query('SET search_path TO "' + schema + '",public');
          for (const migration of [
            new IdentityFoundation1794096000000(),
            new CatalogFoundation1794100000000(),
            new ProductMedia1794101000000(),
            new OriginalMedia1794102000000(),
            new InventoryFoundation1794103000000(),
            new PurchasingFoundation1794104000000(),
            new PurchaseReceipts1794105000000(),
          ])
            await migration.up(r);
          const next = new SupplierInvoices1794106000000();
          await next.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 8);
          await next.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 7);
          await next.up(r);
        } finally {
          await r.query('SET search_path TO public');
          await r.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
          await r.release();
        }
      },
    );
    await t.test(
      'invoice history paginates and can reverse an older invoice; remaining allocations stay exact',
      async () => {
        let s = await state();
        for (let i = 0; i < 21; i++) {
          const l = s.lines.find((l) => BigInt(l.remaining) > 0n)!;
          assert.ok(l);
          const body = {
            ...input('1', s.invoiceRevision, 'PAGE-' + prefix + '-' + i),
            lines: [
              {
                receiptId: l.receiptId,
                orderLineId: l.orderLineId,
                quantity: '1',
                unitCost: '1.00',
              },
            ],
            tax: '0.00',
            delivery: '0.00',
            discount: '0.00',
          };
          assert.equal((await payable('/orders/' + order.id + '/invoices', body)).status, 201);
          s = await state();
        }
        const older = await (await payable('/orders/' + order.id + '?page=2')).json();
        assert.ok(older.items.length > 0);
        assert.equal(older.items.length, older.total - 20);
        const active = older.items.find((i: any) => !i.reversedAt);
        assert.ok(active);
        assert.equal(
          (
            await payable('/invoices/' + active.id + '/reverse', {
              expectedRevision: older.invoiceRevision,
              reason: 'Correction of older paginated invoice',
            })
          ).status,
          201,
        );
      },
    );

    await t.test(
      'received-line pages expose older allocations and reversal audit failure remains atomic',
      async () => {
        let receiving: ReceivingPage = await (
          await call('/orders/' + order.id + '/receiving')
        ).json();
        for (let i = 0; i < 26; i++) {
          assert.equal(
            (
              await call('/orders/' + order.id + '/receipts', {
                expectedRevision: receiving.receiptRevision,
                reason: 'Paged delivery ' + i,
                reference: 'LINES-' + prefix + '-' + i,
                lines: [{ orderLineId: firstLine.orderLineId, quantity: '1' }],
              })
            ).status,
            201,
          );
          receiving = await (await call('/orders/' + order.id + '/receiving')).json();
        }
        const page: InvoicePage = await (
          await payable('/orders/' + order.id + '?linePage=2')
        ).json();
        assert.ok(page.linesTotal > 25);
        assert.ok(page.lines.length > 0);
        const line = page.lines[0]!;
        const posted = await payable('/orders/' + order.id + '/invoices', {
          ...input('1', page.invoiceRevision, 'LINE-PAGE-' + prefix),
          lines: [
            {
              receiptId: line.receiptId,
              orderLineId: line.orderLineId,
              quantity: '1',
              unitCost: '1.01',
            },
          ],
          tax: '0.00',
          discount: '0.00',
          delivery: '0.00',
        });
        assert.equal(posted.status, 201);
        const invoice: InvoiceResult = await posted.json(),
          snapshot = await state(),
          key = randomUUID(),
          body = {
            expectedRevision: snapshot.invoiceRevision,
            reason: 'Correction requiring atomic reversal',
          };
        const name = 'fail_reverse_' + prefix.toLowerCase();
        await db.query(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action='payables.invoice_reversed' THEN RAISE EXCEPTION 'Intentional reversal audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
        try {
          assert.equal(
            (await payable('/invoices/' + invoice.invoiceId + '/reverse', body, key)).status,
            500,
          );
          assert.equal((await state()).invoiceRevision, snapshot.invoiceRevision);
          assert.equal(
            (
              await db.query('SELECT reversed_at FROM supplier_invoices WHERE id=$1', [
                invoice.invoiceId,
              ])
            )[0].reversed_at,
            null,
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
          await db.query(`DROP TRIGGER ${name} ON audit_events;DROP FUNCTION ${name}()`);
        }
        assert.equal(
          (await payable('/invoices/' + invoice.invoiceId + '/reverse', body, key)).status,
          201,
        );
      },
    );
    await t.test(
      'reversing every invoice releases stock corrections and cancellation without erasing documents',
      async () => {
        let snapshot = await state();
        while (snapshot.items.some((i) => !i.reversedAt) || snapshot.total > 20) {
          const active = await db.query(
            'SELECT id FROM supplier_invoices WHERE order_id=$1 AND reversed_at IS NULL ORDER BY id',
            [order.id],
          );
          if (!active.length) break;
          for (const invoice of active) {
            assert.equal(
              (
                await payable('/invoices/' + invoice.id + '/reverse', {
                  expectedRevision: snapshot.invoiceRevision,
                  reason: 'Reverse invoice before correcting delivery',
                })
              ).status,
              201,
            );
            snapshot = await state();
          }
        }
        assert.equal((await state()).unsettled, '0.00');
        const active = await db.query(
          'SELECT r.id FROM purchase_receipts r WHERE r.order_id=$1 AND NOT EXISTS(SELECT 1 FROM purchase_receipt_reversals x WHERE x.receipt_id=r.id)',
          [order.id],
        );
        for (const receipt of active) {
          const receiving: ReceivingPage = await (
            await call('/orders/' + order.id + '/receiving')
          ).json();
          assert.equal(
            (
              await call('/receipts/' + receipt.id + '/reverse', {
                expectedRevision: receiving.receiptRevision,
                reason: 'Correct physical delivery after invoices reversed',
                reference: '',
              })
            ).status,
            201,
          );
        }
        assert.equal(await balance(), '0');
        assert.equal(
          (
            await call('/orders/' + order.id + '/cancel', {
              expectedVersion: 2,
              reason: 'Cancelled after corrections',
            })
          ).status,
          201,
        );
        assert.ok((await state()).total > 20);
      },
    );
  } finally {
    if (app) await app.close();
    try {
      if (ready)
        await db.transaction(async (m) => {
          await m.query(
            'DELETE FROM supplier_invoice_lines WHERE invoice_id IN(SELECT id FROM supplier_invoices WHERE actor_id=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM supplier_invoices WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM supplier_invoice_state WHERE order_id IN(SELECT id FROM purchase_orders WHERE created_by=ANY($1::uuid[]))',
            [users],
          );
          await m.query(
            'DELETE FROM purchase_receipt_reversals WHERE receipt_id IN(SELECT id FROM purchase_receipts WHERE actor_id=ANY($1::uuid[]))',
            [users],
          );
          await m.query(
            'DELETE FROM purchase_receipt_lines WHERE receipt_id IN(SELECT id FROM purchase_receipts WHERE actor_id=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM purchase_receipts WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM purchase_receipt_state WHERE order_id IN(SELECT id FROM purchase_orders WHERE created_by=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM inventory_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM inventory_entries WHERE location_id=$1', [location]);
          await m.query('DELETE FROM inventory_balances WHERE location_id=$1', [location]);
          await m.query('DELETE FROM inventory_postings WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM purchasing_requests WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM purchase_order_lines WHERE order_id IN(SELECT id FROM purchase_orders WHERE created_by=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM purchase_orders WHERE created_by=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM purchasing_suppliers WHERE code LIKE $1', [prefix + '%']);
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
