import { SupplierPayments1794107000000 } from '../src/database/migrations/1794107000000-supplier-payments.js';
import type {
  SupplierPaymentPage,
  PaymentResult,
} from '../src/modules/purchasing/payment.types.js';
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
test('supplier payments: partial allocations, balances and audited reversals', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  const prefix = 'PAY' + randomBytes(5).toString('hex').toUpperCase(),
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
    async function page(id = supplier.id, who = 0): Promise<SupplierPaymentPage> {
      const r = await payable('/suppliers/' + id + '/payments', undefined, randomUUID(), who);
      assert.equal(r.status, 200);
      return r.json();
    }
    async function receive(po: PurchaseOrder) {
      const p: ReceivingPage = await (await call('/orders/' + po.id + '/receiving')).json();
      const r = await call('/orders/' + po.id + '/receipts', {
        expectedRevision: p.receiptRevision,
        reason: 'Physical receipt for payment fixture',
        reference: po.number,
        lines: [{ orderLineId: p.lines[0]!.id, quantity: '50' }],
      });
      assert.equal(r.status, 201);
      return (await r.json()) as ReceiptResult;
    }
    async function invoice(
      po: PurchaseOrder,
      number: string,
      quantity = '10',
      cost = '100.10',
      invoiceOn = '2000-01-01',
    ) {
      const state: InvoicePage = await (await payable('/orders/' + po.id)).json();
      const l = state.lines[0]!;
      const r = await payable('/orders/' + po.id + '/invoices', {
        expectedRevision: state.invoiceRevision,
        number,
        invoiceOn,
        dueOn: invoiceOn,
        tax: '0.00',
        delivery: '0.00',
        discount: '0.00',
        reason: 'Verified supplier document',
        lines: [{ receiptId: l.receiptId, orderLineId: l.orderLineId, quantity, unitCost: cost }],
      });
      assert.equal(r.status, 201);
      return (await r.json()) as InvoiceResult;
    }
    async function another(supplierId: string) {
      const draft = await call('/orders', { ...orderBody(), supplierId });
      assert.equal(draft.status, 201);
      let po: PurchaseOrder = await draft.json();
      const r = await call('/orders/' + po.id + '/issue', { expectedVersion: po.version });
      assert.equal(r.status, 201);
      po = await r.json();
      await receive(po);
      return po;
    }
    await receive(order);
    const a = await invoice(order, 'A-' + prefix),
      otherOrder = await another(supplier.id),
      b = await invoice(otherOrder, 'B-' + prefix, '10', '50.00');
    const otherSupplierResponse = await call('/suppliers', {
      ...supplierBody(),
      code: prefix + 'OTHER',
      name: 'Another supplier',
    });
    assert.equal(otherSupplierResponse.status, 201);
    const otherSupplier: Supplier = await otherSupplierResponse.json(),
      foreignOrder = await another(otherSupplier.id),
      foreign = await invoice(foreignOrder, 'OTHER-' + prefix, '10', '10.00');
    let state = await page();
    const paidOn = state.today;
    const body = (
      amount: string,
      revision = state.paymentRevision,
      reference = 'PAY-' + prefix,
      invoiceId = a.invoiceId,
    ) => ({
      expectedRevision: revision,
      paidOn,
      method: 'bank',
      source: 'Business bank',
      reference,
      amount,
      reason: 'Payment document verified',
      allocations: [{ invoiceId, amount }],
    });
    const record = (input: unknown, key = randomUUID(), who = 0, id = supplier.id) =>
      payable('/suppliers/' + id + '/payments', input, key, who);
    const balance = async () =>
      (
        await db.query(
          'SELECT quantity::text AS n FROM inventory_balances WHERE location_id=$1 AND variant_id=$2',
          [location, variant],
        )
      )[0].n;
    const initialStock = await balance();
    let first: PaymentResult, multiple: PaymentResult;
    await t.test(
      'global commercial read, dedicated pay/reversal permission and CSRF are enforced',
      async () => {
        assert.equal((await payable('/payments', undefined, randomUUID(), 1)).status, 403);
        await db.query(
          "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'payables.read'),($2,'payables.read'),($2,'payables.pay')",
          roles,
        );
        assert.equal((await page(supplier.id, 1)).canRecord, false);
        assert.equal((await record(body('1.00'), randomUUID(), 1)).status, 403);
        assert.equal((await record(body('1.00'), randomUUID(), 2)).status, 403);
        const r = await fetch(base + '/api/v1/payables/suppliers/' + supplier.id + '/payments', {
          method: 'POST',
          headers: {
            ...headers(sessions[0]!),
            'X-CSRF-Token': 'bad',
            'X-Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify(body('1.00')),
        });
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      'identical concurrent retries record one exact partial payment without touching stock',
      async () => {
        const key = randomUUID(),
          input = body('100.01'),
          r = await Promise.all([record(input, key), record(input, key)]);
        assert.deepEqual(
          r.map((r) => r.status),
          [201, 201],
        );
        first = await r[0]!.json();
        assert.deepEqual(await r[1]!.json(), first);
        state = await page();
        assert.equal(state.paid, '100.01');
        assert.equal(state.outstanding, '1400.99');
        assert.equal(state.invoices.find((i) => i.id === a.invoiceId)!.remaining, '900.99');
        assert.equal(state.total, 1);
        assert.equal(await balance(), initialStock);
        assert.equal((await record({ ...input, reason: 'Changed' }, key)).status, 409);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE action='payables.payment_recorded' AND metadata->>'entityId'=$1",
              [first.paymentId],
            )
          )[0].n,
          1,
        );
      },
    );
    await t.test(
      'different concurrent keys cannot double-allocate a stale supplier payment revision',
      async () => {
        const r = await Promise.all([
          record(body('200.00', 2, 'NEXT-A-' + prefix)),
          record(body('200.00', 2, 'NEXT-B-' + prefix)),
        ]);
        assert.deepEqual(r.map((r) => r.status).sort(), [201, 409]);
        state = await page();
        assert.equal(state.paymentRevision, 3);
        assert.equal(state.paid, '300.01');
        assert.equal(state.invoices.find((i) => i.id === a.invoiceId)!.remaining, '700.99');
      },
    );
    await t.test(
      'overpayment, mismatched totals, wrong supplier, duplicate allocations and invalid dates fail atomically',
      async () => {
        assert.equal((await record(body('701.00'))).status, 409);
        assert.equal(
          (await record(body('1.00', 3, 'WRONG-' + prefix, foreign.invoiceId))).status,
          409,
        );
        const input = body('1.00');
        for (const bad of [
          { ...input, amount: 1.1 },
          { ...input, amount: '0.00' },
          { ...input, amount: '1e3' },
          { ...input, allocations: [...input.allocations, ...input.allocations] },
          { ...input, amount: '2.00' },
          { ...input, paidOn: '2199-12-31' },
          { ...input, paidOn: '2026-02-30' },
          { ...input, supplierId: otherSupplier.id },
          { ...input, allocations: [{ invoiceId: a.invoiceId, amount: '-1.00' }] },
        ])
          assert.equal((await record(bad)).status, 400);
        assert.equal((await page()).paymentRevision, 3);
        assert.equal((await page()).total, 2);
      },
    );
    await t.test(
      'paid invoice reversal is blocked by the database and amounts/status reads stay consistent',
      async () => {
        const invoiceState: InvoicePage = await (await payable('/orders/' + order.id)).json();
        assert.equal(invoiceState.items[0]!.paid, '300.01');
        assert.equal(invoiceState.items[0]!.remaining, '700.99');
        assert.equal(invoiceState.unsettled, '700.99');
        const r = await payable('/invoices/' + a.invoiceId + '/reverse', {
          expectedRevision: invoiceState.invoiceRevision,
          reason: 'Must correct payment first',
        });
        assert.equal(r.status, 409);
        assert.equal((await r.json()).code, 'INVOICE_HAS_PAYMENTS');
        const partial = await (await payable('/invoices?status=partial&search=' + prefix)).json();
        assert.equal(partial.total, 1);
        assert.equal(
          (await (await payable('/invoices?status=paid&search=' + prefix)).json()).total,
          0,
        );
      },
    );
    await t.test(
      'one payment spans two purchase orders and references are unique company-wide',
      async () => {
        const input = {
          ...body('300.30', 3, 'MULTI-' + prefix),
          method: 'cash',
          source: 'Main cash drawer',
          allocations: [
            { invoiceId: b.invoiceId, amount: '200.20' },
            { invoiceId: a.invoiceId, amount: '100.10' },
          ],
        };
        const r = await record(input);
        assert.equal(r.status, 201);
        multiple = await r.json();
        state = await page();
        assert.equal(state.paymentRevision, 4);
        assert.equal(state.paid, '600.31');
        assert.equal(state.items[0]!.allocations.length, 2);
        assert.equal(state.invoices.find((i) => i.id === b.invoiceId)!.remaining, '299.80');
        const foreignPage = await page(otherSupplier.id);
        assert.equal(
          (
            await record(
              body('1.00', foreignPage.paymentRevision, 'multi-' + prefix, foreign.invoiceId),
              randomUUID(),
              0,
              otherSupplier.id,
            )
          ).status,
          409,
        );
        assert.equal((await page(otherSupplier.id)).paid, '0.00');
      },
    );
    await t.test(
      'runtime cannot rewrite payments/allocations/revisions and SQL posting rechecks allocation bounds',
      async () => {
        const runtime = createRuntimeDataSource();
        await runtime.initialize();
        try {
          for (const table of [
            'supplier_payments',
            'supplier_payment_allocations',
            'supplier_payment_state',
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
          assert.ok(
            (
              await runtime.query(
                "SELECT reloptions FROM pg_class WHERE oid='public.supplier_invoice_balances'::regclass",
              )
            )[0].reloptions.includes('security_invoker=true'),
          );
          const input = {
            ...body('999.00', 4, 'SQL-' + prefix),
            kind: 'payment',
            supplierId: supplier.id,
            amount: '99900',
            allocations: [{ invoiceId: a.invoiceId, amount: '99900' }],
          };
          await assert.rejects(
            runtime.query('SELECT public.supplier_payment_post($1,$2,$3,$4::jsonb)', [
              randomUUID(),
              users[0],
              randomUUID(),
              JSON.stringify(input),
            ]),
            /PAYMENT_EXCEEDS_DUE/,
          );
        } finally {
          await runtime.destroy();
        }
      },
    );
    await t.test(
      'payment audit failure rolls back allocations, balance, revision and retry key; unchanged retry succeeds',
      async () => {
        const key = randomUUID(),
          input = {
            ...body('1.01', 4, 'ROLLBACK-' + prefix),
            allocations: [
              { invoiceId: a.invoiceId, amount: '0.51' },
              { invoiceId: b.invoiceId, amount: '0.50' },
            ],
          },
          name = 'fail_payment_' + prefix.toLowerCase();
        await db.query(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action='payables.payment_recorded' THEN RAISE EXCEPTION 'Intentional payment audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
        try {
          assert.equal((await record(input, key)).status, 500);
          assert.equal((await page()).paid, '600.31');
          assert.equal((await page()).paymentRevision, 4);
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
        assert.equal((await record(input, key)).status, 201);
        state = await page();
        assert.equal(state.paid, '601.32');
      },
    );
    await t.test(
      'whole-payment reversal restores both invoice balances once and permits a corrected reference',
      async () => {
        const input = {
            expectedRevision: 5,
            reason: 'Correct allocation across supplier invoices',
          },
          key = randomUUID(),
          r = await Promise.all([
            payable('/payments/' + multiple.paymentId + '/reverse', input, key),
            payable('/payments/' + multiple.paymentId + '/reverse', input, key),
          ]);
        assert.deepEqual(
          r.map((r) => r.status),
          [201, 201],
        );
        state = await page();
        assert.equal(state.paid, '301.02');
        assert.equal(state.paymentRevision, 6);
        assert.ok(state.items.find((p) => p.id === multiple.paymentId)!.reversedAt);
        assert.equal(state.items.find((p) => p.id === multiple.paymentId)!.amount, '300.30');
        assert.equal(await balance(), initialStock);
        assert.equal(
          (
            await record({
              ...body('1.00', 6, 'MULTI-' + prefix),
              method: 'mobile',
              source: 'Business mobile wallet',
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await payable('/payments/' + multiple.paymentId + '/reverse', {
              expectedRevision: 7,
              reason: 'Repeated reversal',
            })
          ).status,
          409,
        );
        state = await page();
      },
    );
    await t.test(
      'reversal audit failure restores neither balance nor retry record until successful commit',
      async () => {
        const current = state.items.find(
            (p) => p.reference === 'MULTI-' + prefix && !p.reversedAt,
          )!,
          key = randomUUID(),
          input = {
            expectedRevision: state.paymentRevision,
            reason: 'Correct mobile payment record',
          },
          before = state.paid,
          name = 'fail_payment_reverse_' + prefix.toLowerCase();
        await db.query(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action='payables.payment_reversed' THEN RAISE EXCEPTION 'Intentional payment reversal audit failure';END IF;RETURN NEW;END;$f$;CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
        try {
          assert.equal(
            (await payable('/payments/' + current.id + '/reverse', input, key)).status,
            500,
          );
          assert.equal((await page()).paid, before);
          assert.equal((await page()).paymentRevision, input.expectedRevision);
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
          (await payable('/payments/' + current.id + '/reverse', input, key)).status,
          201,
        );
        state = await page();
      },
    );
    await t.test(
      'revoked payment rights block cached replay; pay permission does not grant reversal',
      async () => {
        await db.query(
          "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'payables.pay')",
          [roles[0]],
        );
        const input = body('0.01', state.paymentRevision, 'REVOKED-' + prefix),
          key = randomUUID(),
          r = await record(input, key, 1);
        assert.equal(r.status, 201);
        const posted: PaymentResult = await r.json();
        assert.equal(
          (
            await payable(
              '/payments/' + posted.paymentId + '/reverse',
              { expectedRevision: posted.paymentRevision, reason: 'Not permitted' },
              randomUUID(),
              1,
            )
          ).status,
          403,
        );
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='payables.pay'",
          [roles[0]],
        );
        assert.equal((await record(input, key, 1)).status, 403);
        state = await page();
      },
    );
    await t.test(
      'payment and invoice reversal race cannot produce an allocation to a reversed invoice',
      async () => {
        const race = await invoice(order, 'RACE-' + prefix, '1', '10.00', '2000-01-02'),
          invoiceState: InvoicePage = await (await payable('/orders/' + order.id)).json();
        assert.equal(
          (
            await record({
              ...body('0.01', state.paymentRevision, 'EARLY-' + prefix, race.invoiceId),
              paidOn: '2000-01-01',
            })
          ).status,
          400,
        );
        const r = await Promise.all([
          record(body('0.01', state.paymentRevision, 'RACE-PAY-' + prefix, race.invoiceId)),
          payable('/invoices/' + race.invoiceId + '/reverse', {
            expectedRevision: invoiceState.invoiceRevision,
            reason: 'Race with payment',
          }),
        ]);
        assert.deepEqual(r.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id JOIN supplier_invoices i ON i.id=a.invoice_id WHERE p.reversed_at IS NULL AND i.reversed_at IS NOT NULL AND i.supplier_id=$1',
              [supplier.id],
            )
          )[0].n,
          0,
        );
        state = await page();
      },
    );
    await t.test(
      'supplier search, inactive master and payment search retain history with literal matching',
      async () => {
        await db.query('UPDATE purchasing_suppliers SET is_active=false WHERE id=$1', [
          supplier.id,
        ]);
        const found = await (await payable('/payment-suppliers?search=' + prefix)).json();
        assert.ok(found.some((s: Supplier) => s.id === supplier.id && !s.isActive));
        assert.equal(
          (await record(body('0.01', state.paymentRevision, 'INACTIVE-' + prefix))).status,
          201,
        );
        state = await page();
        const list = await (await payable('/payments?search=' + prefix + '&status=active')).json();
        assert.ok(list.items.length > 0);
        assert.equal((await (await payable('/payments?search=%25')).json()).total, 0);
        assert.equal((await payable('/payments?page=0')).status, 400);
        assert.equal((await payable('/payments?status=unknown')).status, 400);
      },
    );
    await t.test(
      'payment migration refuses discarding history and reverts an empty compiled scratch schema',
      async () => {
        const live = db.createQueryRunner();
        await live.connect();
        try {
          await assert.rejects(new SupplierPayments1794107000000().down(live), /Cannot discard/);
        } finally {
          await live.release();
        }
        const schema = 'payment_scratch_' + prefix.toLowerCase(),
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
            new SupplierInvoices1794106000000(),
          ])
            await migration.up(r);
          const next = new SupplierPayments1794107000000();
          await next.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 9);
          await next.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 8);
          await next.up(r);
        } finally {
          await r.query('SET search_path TO public');
          await r.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
          await r.release();
        }
      },
    );
    await t.test(
      'outstanding invoice and payment history pages expose older records and reconcile after reversal',
      async () => {
        for (let i = 0; i < 26; i++)
          await invoice(order, 'PAGE-BILL-' + prefix + '-' + i, '1', '1.00');
        const older: SupplierPaymentPage = await (
          await payable('/suppliers/' + supplier.id + '/payments?invoicePage=2')
        ).json();
        assert.ok(older.invoicesTotal > 25);
        assert.ok(older.invoices.length > 0);
        const selected = older.invoices[0]!;
        assert.equal(
          (await record(body('0.01', older.paymentRevision, 'PAGE-INVOICE-' + prefix, selected.id)))
            .status,
          201,
        );
        state = await page();
        for (let i = 0; i < 21; i++) {
          assert.equal(
            (await record(body('0.01', state.paymentRevision, 'PAGE-PAY-' + prefix + '-' + i)))
              .status,
            201,
          );
          state = await page();
        }
        const history: SupplierPaymentPage = await (
          await payable('/suppliers/' + supplier.id + '/payments?page=2')
        ).json();
        assert.ok(history.total > 20);
        assert.ok(history.items.length > 0);
        const active = history.items.find((p) => !p.reversedAt)!;
        assert.ok(active);
        assert.equal(
          (
            await payable('/payments/' + active.id + '/reverse', {
              expectedRevision: history.paymentRevision,
              reason: 'Correct older payment history',
            })
          ).status,
          201,
        );
        state = await page();
        const derived = (
          await db.query(
            'SELECT coalesce(sum(a.amount_minor),0)::text AS paid FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id WHERE p.supplier_id=$1 AND p.reversed_at IS NULL',
            [supplier.id],
          )
        )[0].paid;
        assert.equal(BigInt(derived), BigInt(state.paid.replace('.', '')));
      },
    );
    await t.test(
      'completing the exact remaining amount derives Paid and rejects a further allocation',
      async () => {
        state = await page();
        const before: InvoicePage = await (await payable('/orders/' + otherOrder.id)).json();
        const target = before.items.find((i) => i.id === b.invoiceId)!;
        assert.ok(target);
        assert.equal(
          (
            await record(
              body(target.remaining, state.paymentRevision, 'COMPLETE-' + prefix, b.invoiceId),
            )
          ).status,
          201,
        );
        state = await page();
        assert.ok(!state.invoices.some((i) => i.id === b.invoiceId));
        const invoices: InvoicePage = await (await payable('/orders/' + otherOrder.id)).json(),
          complete = invoices.items.find((i) => i.id === b.invoiceId)!;
        assert.equal(complete.remaining, '0.00');
        assert.equal(complete.paid, complete.total);
        const list = await (await payable('/invoices?status=paid&search=' + prefix)).json();
        assert.ok(list.items.some((i: { id: string }) => i.id === b.invoiceId));
        assert.equal(
          (await record(body('0.01', state.paymentRevision, 'OVER-PAID-' + prefix, b.invoiceId)))
            .status,
          409,
        );
      },
    );
    await t.test(
      'reversing all allocated payments releases invoice corrections and preserves physical stock',
      async () => {
        const active = await db.query(
          'SELECT id FROM supplier_payments WHERE supplier_id=$1 AND reversed_at IS NULL ORDER BY id',
          [supplier.id],
        );
        for (const p of active) {
          state = await page();
          assert.equal(
            (
              await payable('/payments/' + p.id + '/reverse', {
                expectedRevision: state.paymentRevision,
                reason: 'Release invoice allocations for correction',
              })
            ).status,
            201,
          );
        }
        state = await page();
        assert.equal(state.paid, '0.00');
        const invoiceState: InvoicePage = await (await payable('/orders/' + order.id)).json();
        assert.equal(invoiceState.items.find((i) => i.id === a.invoiceId)?.paid ?? '0.00', '0.00');
        assert.equal(
          (
            await payable('/invoices/' + a.invoiceId + '/reverse', {
              expectedRevision: invoiceState.invoiceRevision,
              reason: 'Correct invoice after payments reversed',
            })
          ).status,
          201,
        );
        assert.equal(await balance(), initialStock);
        assert.ok(state.total > 20);
      },
    );
  } finally {
    if (app) await app.close();
    try {
      if (ready)
        await db.transaction(async (m) => {
          await m.query(
            'DELETE FROM supplier_payment_allocations WHERE payment_id IN(SELECT id FROM supplier_payments WHERE actor_id=ANY($1::uuid[]))',
            [users],
          );
          await m.query('DELETE FROM supplier_payments WHERE actor_id=ANY($1::uuid[])', [users]);
          await m.query(
            'DELETE FROM supplier_payment_state WHERE supplier_id IN(SELECT id FROM purchasing_suppliers WHERE code LIKE $1)',
            [prefix + '%'],
          );
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
