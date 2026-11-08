import { PayablesReportService } from '../src/modules/purchasing/report.service.js';
import type { DataSource, EntityManager } from 'typeorm';
import type { AgingReport, SupplierStatement } from '../src/modules/purchasing/report.types.js';
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
test('payables reports: recorded-time statements, historical aging and CSV safety', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  const prefix = 'RPT' + randomBytes(5).toString('hex').toUpperCase(),
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
    const cutoff = '2020-04-01',
      ids: string[] = [],
      dueDates = [
        '2020-04-02',
        '2020-04-01',
        '2020-03-31',
        '2020-03-02',
        '2020-03-01',
        '2020-02-01',
        '2020-01-31',
        '2020-01-02',
        '2020-01-01',
      ];
    for (let i = 0; i < dueDates.length; i++) {
      const posted = await invoice(
        order,
        'AGE-' + prefix + '-' + i,
        '1',
        '100.' + String(i + 1).padStart(2, '0'),
      );
      ids.push(posted.invoiceId);
      await db.query('UPDATE supplier_invoices SET created_at=$2,due_on=$3 WHERE id=$1', [
        posted.invoiceId,
        '2020-03-01T00:00:00+06:00',
        dueDates[i],
      ]);
    }
    const payment = await payable('/suppliers/' + supplier.id + '/payments', {
      expectedRevision: 1,
      paidOn: '2000-01-01',
      method: 'bank',
      source: 'Report fixture bank',
      reference: 'REPORT-PAY-' + prefix,
      amount: '10.01',
      reason: 'Historical partial payment',
      allocations: [{ invoiceId: ids[2], amount: '10.01' }],
    });
    assert.equal(payment.status, 201);
    const pay: PaymentResult = await payment.json();
    await db.query('UPDATE supplier_payments SET created_at=$2 WHERE id=$1', [
      pay.paymentId,
      '2020-03-15T12:00:00+06:00',
    ]);
    async function aging(asOf = cutoff, search = prefix, page = 1): Promise<AgingReport> {
      const r = await payable(
        '/reports/aging?' + new URLSearchParams({ asOf, search, page: String(page) }),
      );
      assert.equal(r.status, 200);
      return r.json();
    }
    async function statement(
      from = '2020-03-01',
      to = cutoff,
      extra = '',
    ): Promise<SupplierStatement> {
      const r = await payable(
        '/suppliers/' + supplier.id + '/statement?' + new URLSearchParams({ from, to }) + extra,
      );
      assert.equal(r.status, 200);
      return r.json();
    }
    await t.test(
      'reports and CSV require fresh global commercial read; read-only grants are sufficient',
      async () => {
        for (const path of [
          '/reports/aging',
          '/suppliers/' + supplier.id + '/statement',
          '/suppliers/' + supplier.id + '/statement.csv',
        ])
          assert.equal((await payable(path, undefined, randomUUID(), 1)).status, 403);
        await db.query(
          "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'payables.read'),($2,'payables.read')",
          roles,
        );
        assert.equal((await payable('/reports/aging', undefined, randomUUID(), 1)).status, 200);
        assert.equal(
          (await payable('/suppliers/' + supplier.id + '/statement', undefined, randomUUID(), 1))
            .status,
          200,
        );
        assert.equal(
          (
            await payable(
              '/suppliers/' + supplier.id + '/statement.csv',
              undefined,
              randomUUID(),
              1,
            )
          ).status,
          200,
        );
        assert.equal((await payable('/reports/aging', undefined, randomUUID(), 2)).status, 403);
        const unauthenticated = await fetch(base + '/api/v1/payables/reports/aging');
        assert.equal(unauthenticated.status, 401);
      },
    );
    await t.test(
      'all aging boundaries use remaining cents and Bangladesh due-day differences',
      async () => {
        const report = await aging();
        assert.equal(report.total, 1);
        assert.equal(report.totals.invoiceCount, 9);
        assert.equal(report.totals.outstanding, '890.44');
        assert.equal(report.totals.notDue, '200.03');
        assert.equal(report.totals.days1to30, '190.06');
        assert.equal(report.totals.days31to60, '200.11');
        assert.equal(report.totals.days61to90, '200.15');
        assert.equal(report.totals.over90, '100.09');
        assert.equal(report.items[0]!.id, supplier.id);
        const s = await statement();
        assert.equal(s.totals.closing, '890.44');
        assert.equal(s.totals.outstanding, s.totals.closing);
        assert.equal(s.totals.invoiceTotal, '900.45');
        assert.equal(s.totals.paid, '10.01');
        assert.equal(s.invoices.find((i) => i.id === ids[2])!.remaining, '90.02');
      },
    );
    await t.test(
      'period opening and empty activity retain earlier recorded balances; equal timestamps share closing values',
      async () => {
        const whole = await statement();
        assert.equal(whole.totals.opening, '0.00');
        assert.equal(whole.totals.increased, '900.45');
        assert.equal(whole.totals.decreased, '10.01');
        assert.equal(whole.total, 10);
        for (const event of whole.items.filter((e) => e.kind === 'invoice')) {
          assert.equal(event.sameTimeEvents, 9);
          assert.equal(event.balanceAtTime, '900.45');
        }
        const empty = await statement('2020-03-16');
        assert.equal(empty.total, 0);
        assert.equal(empty.totals.opening, '890.44');
        assert.equal(empty.totals.increased, '0.00');
        assert.equal(empty.totals.decreased, '0.00');
        assert.equal(empty.totals.closing, '890.44');
        const day = await statement('2020-03-15', '2020-03-15');
        assert.equal(day.total, 1);
        assert.equal(day.totals.opening, '900.45');
        assert.equal(day.totals.decreased, '10.01');
        const before = await statement('2020-02-01', '2020-02-29');
        assert.equal(before.total, 0);
        assert.equal(before.totals.closing, '0.00');
      },
    );
    let late: InvoiceResult;
    await t.test(
      'one repeatable-read report stays consistent when a payment changes between its queries',
      async () => {
        const runtime = createRuntimeDataSource();
        await runtime.initialize();
        let changed = false;
        const source = {
          transaction: async (
            isolation: 'REPEATABLE READ',
            work: (m: EntityManager) => Promise<unknown>,
          ) => {
            assert.equal(isolation, 'REPEATABLE READ');
            return runtime.transaction(isolation, async (m) => {
              const original = m.query.bind(m),
                manager = new Proxy(m, {
                  get(target, key, receiver) {
                    if (key === 'query')
                      return async (sql: string, params?: unknown[]) => {
                        const result = await original(sql, params);
                        if (!changed && sql.includes(' AS opening')) {
                          changed = true;
                          await db.query('UPDATE supplier_payments SET created_at=$2 WHERE id=$1', [
                            pay.paymentId,
                            '2020-04-02T01:00:00+06:00',
                          ]);
                        }
                        return result;
                      };
                    return Reflect.get(target, key, receiver);
                  },
                });
              return work(manager);
            });
          },
        } as unknown as Pick<DataSource, 'transaction'>;
        try {
          const result = await new PayablesReportService(source).statement(
            supplier.id,
            { from: '2020-03-01', to: cutoff, page: 1, invoicePage: 1 },
            {
              id: users[0]!,
              username: names[0]!,
              displayName: 'Report fixture',
              mustChangePassword: false,
              sessionId: randomUUID(),
              csrfToken: 'not-used-for-read',
              grants: [
                { code: 'purchasing.read', locationId: null },
                { code: 'payables.read', locationId: null },
              ],
            },
          );
          assert.equal(changed, true);
          assert.equal(result.totals.closing, '890.44');
          assert.equal(result.totals.paid, '10.01');
          assert.equal((await statement()).totals.closing, '900.45');
        } finally {
          await db.query('UPDATE supplier_payments SET created_at=$2 WHERE id=$1', [
            pay.paymentId,
            '2020-03-15T12:00:00+06:00',
          ]);
          await runtime.destroy();
        }
      },
    );
    await t.test(
      'backdated documents recorded later stay out of old reports; the Bangladesh midnight cutoff is exclusive',
      async () => {
        late = await invoice(order, 'LATE-' + prefix, '1', '50.00');
        assert.equal((await aging()).totals.outstanding, '890.44');
        await db.query('UPDATE supplier_invoices SET created_at=$2 WHERE id=$1', [
          late.invoiceId,
          '2020-04-01T18:00:00Z',
        ]);
        assert.equal((await aging()).totals.outstanding, '890.44');
        assert.equal((await aging('2020-04-02')).totals.outstanding, '940.44');
        const s = await statement('2020-04-02', '2020-04-02');
        assert.equal(s.total, 1);
        assert.equal(s.items[0]!.recordedOn, '2020-04-02');
        assert.equal(s.items[0]!.documentOn, '2000-01-01');
        assert.equal(s.totals.opening, '890.44');
        assert.equal(s.totals.increased, '50.00');
      },
    );
    await t.test(
      'later payment and invoice reversals change later cutoffs without restating earlier balances',
      async () => {
        const reversed = await payable('/payments/' + pay.paymentId + '/reverse', {
          expectedRevision: 2,
          reason: 'Historical payment correction',
        });
        assert.equal(reversed.status, 201);
        await db.query('UPDATE supplier_payments SET reversed_at=$2 WHERE id=$1', [
          pay.paymentId,
          '2020-04-02T00:00:00+06:00',
        ]);
        const current: InvoicePage = await (await payable('/orders/' + order.id)).json();
        assert.equal(
          (
            await payable('/invoices/' + ids[8] + '/reverse', {
              expectedRevision: current.invoiceRevision,
              reason: 'Historical invoice correction',
            })
          ).status,
          201,
        );
        await db.query('UPDATE supplier_invoices SET reversed_at=$2 WHERE id=$1', [
          ids[8],
          '2020-04-03T23:59:59.999+06:00',
        ]);
        assert.equal((await aging()).totals.outstanding, '890.44');
        assert.equal((await aging('2020-04-02')).totals.outstanding, '950.45');
        assert.equal((await aging('2020-04-03')).totals.outstanding, '850.36');
        const s = await statement('2020-04-02', '2020-04-03');
        assert.equal(s.totals.opening, '890.44');
        assert.equal(s.totals.increased, '60.01');
        assert.equal(s.totals.decreased, '100.09');
        assert.equal(s.totals.closing, '850.36');
        assert.equal(s.items.filter((e) => e.recordedOn === '2020-04-02').length, 2);
        assert.ok(
          s.items
            .filter((e) => e.recordedOn === '2020-04-02')
            .every((e) => e.balanceAtTime === '950.45'),
        );
      },
    );
    await t.test(
      'strict query validation rejects invalid dates, future cutoffs, ranges, pages and mass assignment',
      async () => {
        for (const path of [
          '/reports/aging?asOf=2020-02-30',
          '/reports/aging?asOf=2199-01-01',
          '/reports/aging?page=0',
          '/reports/aging?page=10001',
          '/reports/aging?status=paid',
          '/reports/aging?asOf=2020-04-01&asOf=2020-04-02',
          '/suppliers/' + supplier.id + '/statement?from=2020-04-02&to=2020-04-01',
          '/suppliers/' + supplier.id + '/statement?to=2199-01-01',
          '/suppliers/' + supplier.id + '/statement?invoicePage=0',
          '/suppliers/' + supplier.id + '/statement.csv?page=2',
        ])
          assert.equal((await payable(path)).status, 400);
        assert.equal((await payable('/suppliers/' + randomUUID() + '/statement')).status, 404);
      },
    );
    await t.test(
      'inactive supplier headers use current directory names while literal report search stays bounded',
      async () => {
        await db.query('UPDATE purchasing_suppliers SET is_active=false,name=$2 WHERE id=$1', [
          supplier.id,
          'Changed report supplier',
        ]);
        const s = await statement();
        assert.equal(s.supplier.isActive, false);
        assert.equal(s.supplier.name, 'Changed report supplier');
        assert.equal((await aging()).items[0]!.isActive, false);
        assert.equal((await aging(cutoff, '%')).total, 0);
        assert.equal((await aging(cutoff, '_')).total, 0);
      },
    );
    await t.test(
      'global totals include suppliers beyond the selected page and supplier statements reconcile',
      async () => {
        for (let i = 0; i < 21; i++) {
          const r = await call('/suppliers', {
            ...supplierBody(),
            code: prefix + 'P' + i,
            name: 'Report supplier ' + i,
          });
          assert.equal(r.status, 201);
          const s: Supplier = await r.json(),
            po = await another(s.id),
            bill = await invoice(po, 'PAGE-' + prefix + '-' + i, '1', '1.00');
          await db.query('UPDATE supplier_invoices SET created_at=$2,due_on=$3 WHERE id=$1', [
            bill.invoiceId,
            '2020-03-01T01:00:00+06:00',
            cutoff,
          ]);
        }
        const a = await aging(),
          b = await aging(cutoff, prefix, 2);
        assert.equal(a.total, 22);
        assert.equal(a.items.length, 20);
        assert.equal(b.items.length, 2);
        assert.deepEqual(a.totals, b.totals);
        assert.equal(a.totals.outstanding, '911.44');
        assert.equal(a.totals.invoiceCount, 30);
        assert.equal((await statement()).totals.closing, '890.44');
      },
    );
    await t.test(
      'activity and outstanding invoice pagination keep full-period totals and continuous time-group balances',
      async () => {
        for (let i = 0; i < 21; i++) {
          const bill = await invoice(order, 'HISTORY-' + prefix + '-' + i, '1', '1.00');
          await db.query('UPDATE supplier_invoices SET created_at=$2,due_on=$3 WHERE id=$1', [
            bill.invoiceId,
            '2020-03-02T08:00:00+06:00',
            cutoff,
          ]);
        }
        const a = await statement('2020-03-01', '2020-04-03'),
          b = await statement('2020-03-01', '2020-04-03', '&page=2&invoicePage=2');
        assert.equal(a.total, 34);
        assert.equal(a.items.length, 20);
        assert.equal(b.items.length, 14);
        assert.equal(a.invoicesTotal, 30);
        assert.equal(b.invoices.length, 5);
        assert.deepEqual(a.totals, b.totals);
        assert.equal(a.totals.closing, '871.36');
        assert.equal(new Set([...a.items, ...b.items].map((e) => e.id)).size, 34);
        assert.ok(
          [...a.items, ...b.items]
            .filter((e) => e.reference.startsWith('HISTORY-'))
            .every((e) => e.sameTimeEvents === 21 && e.balanceAtTime === '921.45'),
        );
      },
    );
    await t.test(
      'CSV is protected UTF-8, contains all period pages, handles quotes and neutralizes spreadsheet formulas',
      async () => {
        await db.query('UPDATE purchasing_suppliers SET name=$2 WHERE id=$1', [
          supplier.id,
          '=SUM(1,2)',
        ]);
        await db.query('UPDATE supplier_invoices SET reason=$2 WHERE id=$1', [
          ids[0],
          '  +HYPERLINK("bad")\nবাংলা',
        ]);
        const r = await payable(
          '/suppliers/' + supplier.id + '/statement.csv?from=2020-03-01&to=2020-04-03',
        );
        assert.equal(r.status, 200);
        assert.match(r.headers.get('content-type') ?? '', /^text\/csv/);
        assert.match(r.headers.get('cache-control') ?? '', /no-store/);
        assert.match(
          r.headers.get('content-disposition') ?? '',
          /attachment; filename="supplier-statement-/,
        );
        const bytes = new Uint8Array(await r.arrayBuffer());
        assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
        const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
        assert.ok(csv.includes('"\'=SUM(1,2)"'));
        assert.ok(csv.includes('\'  +HYPERLINK(""bad"")'));
        assert.ok(csv.includes('বাংলা'));
        assert.ok(csv.includes('Closing balance'));
        assert.ok(csv.includes('871.36'));
        assert.equal((csv.match(/"invoice",/g) ?? []).length, 31);
        assert.ok(csv.endsWith('\r\n'));
        assert.ok(!csv.includes('\\r\\n'));
      },
    );
    await t.test(
      'source inconsistencies fail closed instead of exporting mismatched financial totals',
      async () => {
        await db.query('UPDATE supplier_payments SET amount_minor=amount_minor+1 WHERE id=$1', [
          pay.paymentId,
        ]);
        try {
          for (const path of [
            '/reports/aging?asOf=2020-04-01&search=' + prefix,
            '/suppliers/' + supplier.id + '/statement?from=2020-03-01&to=2020-04-01',
            '/suppliers/' + supplier.id + '/statement.csv?from=2020-03-01&to=2020-04-01',
          ]) {
            const r = await payable(path);
            assert.equal(r.status, 503);
            assert.equal((await r.json()).code, 'REPORT_RECONCILIATION');
          }
        } finally {
          await db.query('UPDATE supplier_payments SET amount_minor=amount_minor-1 WHERE id=$1', [
            pay.paymentId,
          ]);
        }
      },
    );
    await t.test(
      'CSV export rejects more than 5000 events while JSON remains paginated',
      async () => {
        const created = await call('/suppliers', {
          ...supplierBody(),
          code: prefix + 'BULK',
          name: 'Report export limit fixture',
        });
        assert.equal(created.status, 201);
        const s: Supplier = await created.json(),
          draft = await call('/orders', {
            ...orderBody(),
            supplierId: s.id,
            lines: [{ variantId: variant, quantity: '10000', unitCost: '0.01' }],
          });
        assert.equal(draft.status, 201);
        let po: PurchaseOrder = await draft.json();
        po = await (
          await call('/orders/' + po.id + '/issue', { expectedVersion: po.version })
        ).json();
        const receiving: ReceivingPage = await (
          await call('/orders/' + po.id + '/receiving')
        ).json();
        const stock = await call('/orders/' + po.id + '/receipts', {
          expectedRevision: 1,
          reason: 'Large disposable report fixture',
          reference: po.number,
          lines: [{ orderLineId: receiving.lines[0]!.id, quantity: '6000' }],
        });
        assert.equal(stock.status, 201);
        const receipt: ReceiptResult = await stock.json();
        await db.transaction(async (m) => {
          await m.query(
            "INSERT INTO supplier_invoices(order_id,supplier_id,supplier_snapshot,number,invoice_on,due_on,goods_minor,tax_minor,delivery_minor,discount_minor,reason,actor_id) SELECT o.id,o.supplier_id,o.supplier_snapshot,$2||g::text,'2000-01-01','2000-01-01',1,0,0,0,'Disposable bulk report fixture',$3::uuid FROM purchase_orders o CROSS JOIN generate_series(1,5001) g WHERE o.id=$1",
            [po.id, 'BULK-' + prefix + '-', users[0]],
          );
          await m.query(
            'INSERT INTO supplier_invoice_lines(invoice_id,receipt_id,order_line_id,quantity,unit_cost_minor) SELECT id,$2::uuid,$3::uuid,1,1 FROM supplier_invoices WHERE order_id=$1',
            [po.id, receipt.receiptId, receiving.lines[0]!.id],
          );
          await m.query('INSERT INTO supplier_invoice_state(order_id,version) VALUES($1,5002)', [
            po.id,
          ]);
        });
        const r = await payable('/suppliers/' + s.id + '/statement.csv?from=2000-01-01');
        assert.equal(r.status, 409);
        assert.equal((await r.json()).code, 'REPORT_EXPORT_TOO_LARGE');
        const json = await payable('/suppliers/' + s.id + '/statement?from=2000-01-01');
        assert.equal(json.status, 200);
        const report: SupplierStatement = await json.json();
        assert.equal(report.total, 5001);
        assert.equal(report.items.length, 20);
        assert.equal(report.totals.closing, '50.01');
      },
    );
    await t.test(
      'report reads leave business records, revisions, retry caches and audits unchanged; revoked reads take effect',
      async () => {
        const counts = async () =>
          (
            await db.query(
              'SELECT (SELECT count(*)::int FROM supplier_invoices) AS invoices,(SELECT count(*)::int FROM supplier_payments) AS payments,(SELECT sum(version)::text FROM supplier_invoice_state) AS invoice_versions,(SELECT sum(version)::text FROM supplier_payment_state) AS payment_versions,(SELECT count(*)::int FROM purchasing_requests) AS requests,(SELECT count(*)::int FROM audit_events WHERE actor_id=ANY($1::uuid[])) AS audits',
              [users],
            )
          )[0];
        const before = await counts();
        await aging();
        await statement();
        await payable('/suppliers/' + supplier.id + '/statement.csv');
        assert.deepEqual(await counts(), before);
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='payables.read'",
          [roles[0]],
        );
        assert.equal((await payable('/reports/aging', undefined, randomUUID(), 1)).status, 403);
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
