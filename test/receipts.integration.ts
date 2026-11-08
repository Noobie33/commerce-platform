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
test('purchase receipts: atomic partial receiving, reversals and permissions', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  const prefix = 'REC' + randomBytes(5).toString('hex').toUpperCase(),
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
    const progress = async (who = 0): Promise<ReceivingPage> => {
      const r = await call('/orders/' + order.id + '/receiving', undefined, randomUUID(), who);
      assert.equal(r.status, 200);
      return r.json();
    };
    let state = await progress();
    const line = state.lines[0]!,
      firstKey = randomUUID();
    let first: ReceiptResult;
    const body = (quantity: string, revision = state.receiptRevision, reference = '') => ({
      expectedRevision: revision,
      reason: 'Receive counted supplier goods',
      reference,
      lines: [{ orderLineId: line.id, quantity }],
    });
    const balance = async () =>
      (
        await db.query(
          'SELECT quantity::text AS n FROM inventory_balances WHERE location_id=$1 AND variant_id=$2',
          [location, variant],
        )
      )[0]?.n ?? '0';
    async function inventory(input: unknown, key = randomUUID(), path = '/postings') {
      const r = await fetch(base + '/api/v1/inventory' + path, {
        method: 'POST',
        headers: { ...headers(sessions[0]!), 'X-Idempotency-Key': key },
        body: JSON.stringify(input),
      });
      const id = r.headers.get('x-request-id');
      if (id) requests.push(id);
      return r;
    }
    const adjustment = (quantity: string) => ({
      kind: 'adjustment',
      locationId: location,
      destinationId: null,
      reason: 'Disposable receipt concurrency fixture',
      reference: '',
      lines: [{ variantId: variant, quantity }],
    });
    await t.test(
      'global purchasing read and location-specific stock/action permissions are required',
      async () => {
        assert.equal(
          (await call('/orders/' + order.id + '/receipts', body('1'), randomUUID(), 1)).status,
          403,
        );
        assert.equal(
          (await call('/orders/' + order.id + '/receipts', body('1'), randomUUID(), 2)).status,
          403,
        );
        const read = await progress(1);
        assert.equal(read.canReceive, false);
        const r = await fetch(base + '/api/v1/purchasing/orders/' + order.id + '/receipts', {
          method: 'POST',
          headers: { ...headers(sessions[0]!), 'X-CSRF-Token': '' },
          body: JSON.stringify(body('1')),
        });
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      'identical concurrent partial receipts create one stock posting and one receipt',
      async () => {
        const input = body('30', 1, 'DOC-1'),
          responses = await Promise.all([
            call('/orders/' + order.id + '/receipts', input, firstKey),
            call('/orders/' + order.id + '/receipts', input, firstKey),
          ]);
        assert.deepEqual(
          responses.map((r) => r.status),
          [201, 201],
        );
        first = await responses[0]!.json();
        assert.deepEqual(await responses[1]!.json(), first);
        state = await progress();
        assert.equal(state.receiptRevision, 2);
        assert.equal(state.total, 1);
        assert.equal(state.lines[0]!.received, '30');
        assert.equal(state.lines[0]!.remaining, '70');
        assert.equal(await balance(), '30');
        assert.equal(
          (await call('/orders/' + order.id + '/receipts', body('31', 1, 'DOC-1'), firstKey))
            .status,
          409,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE actor_id=$1 AND action='purchasing.receipt_created'",
              [users[0]],
            )
          )[0].n,
          1,
        );
        const current = await (await call('/orders/' + order.id)).json();
        assert.equal(current.version, order.version);
        assert.equal(current.total, '10010.00');
      },
    );
    await t.test(
      'different concurrent receipt requests cannot both consume stale remaining quantities',
      async () => {
        const input = body('50', 2, 'DOC-2'),
          responses = await Promise.all([
            call('/orders/' + order.id + '/receipts', input),
            call('/orders/' + order.id + '/receipts', input),
          ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        state = await progress();
        assert.equal(state.receiptRevision, 3);
        assert.equal(state.lines[0]!.received, '80');
        assert.equal(await balance(), '80');
      },
    );
    await t.test(
      'over-receipt, foreign/duplicate lines and repeated active document references are rejected atomically',
      async () => {
        assert.equal((await call('/orders/' + order.id + '/receipts', body('21'))).status, 409);
        assert.equal(
          (
            await call('/orders/' + order.id + '/receipts', {
              ...body('1'),
              lines: [...body('1').lines, { orderLineId: randomUUID(), quantity: '1' }],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call('/orders/' + order.id + '/receipts', {
              ...body('1'),
              lines: [...body('1').lines, ...body('1').lines],
            })
          ).status,
          400,
        );
        assert.equal(
          (await call('/orders/' + order.id + '/receipts', body('1', 3, ' doc-1 '))).status,
          409,
        );
        assert.equal(await balance(), '80');
        assert.equal((await progress()).receiptRevision, 3);
      },
    );
    await t.test(
      'a stock-only request key cannot be reused to claim an existing movement as a PO receipt',
      async () => {
        const key = randomUUID(),
          input = body('1', 3, 'COLLISION');
        const r = await inventory(
          {
            kind: 'receipt',
            locationId: location,
            destinationId: null,
            reason: input.reason,
            reference: input.reference,
            lines: [{ variantId: variant, quantity: '1' }],
          },
          key,
        );
        assert.equal(r.status, 201);
        const posting = await r.json();
        assert.equal((await call('/orders/' + order.id + '/receipts', input, key)).status, 409);
        assert.equal((await progress()).lines[0]!.received, '80');
        assert.equal(await balance(), '81');
        assert.equal(
          (
            await inventory(
              { reason: 'Undo independent collision fixture', reference: '' },
              randomUUID(),
              '/postings/' + posting.id + '/reverse',
            )
          ).status,
          201,
        );
        assert.equal(await balance(), '80');
      },
    );
    await t.test(
      'PO receipts can only be reversed through Purchasing, including direct SQL protections',
      async () => {
        assert.equal(
          (
            await inventory(
              { reason: 'Wrong entry point', reference: '' },
              randomUUID(),
              '/postings/' + first.inventoryPostingId + '/reverse',
            )
          ).status,
          409,
        );
        const preview = await fetch(
          base + '/api/v1/inventory/postings/' + first.inventoryPostingId + '/reversal-preview',
          { headers: headers(sessions[0]!) },
        );
        assert.equal(preview.status, 409);
        const r = await fetch(base + '/api/v1/inventory/locations/' + location + '/history', {
          headers: headers(sessions[0]!),
        });
        assert.equal(r.status, 200);
        const h = await r.json();
        const managed = h.items.find((row: { id: string }) => row.id === first.inventoryPostingId);
        assert.equal(managed.canReverse, false);
        assert.equal(managed.isPurchaseReceipt, true);
        const runtime = createRuntimeDataSource();
        await runtime.initialize();
        try {
          assert.equal(
            (
              await runtime.query(
                "SELECT has_function_privilege(current_user,'public.inventory_post_core(uuid,uuid,uuid,jsonb)','EXECUTE') AS allowed",
              )
            )[0].allowed,
            false,
          );
          await assert.rejects(
            runtime.query('SELECT public.inventory_post_core($1,$2,$3,$4::jsonb)', [
              randomUUID(),
              users[0],
              randomUUID(),
              JSON.stringify(adjustment('1')),
            ]),
          );
          for (const table of [
            'purchase_receipts',
            'purchase_receipt_lines',
            'purchase_receipt_reversals',
            'purchase_receipt_state',
          ])
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
        } finally {
          await runtime.destroy();
        }
      },
    );
    await t.test(
      'insufficient-stock reversal rolls back receipt progress; unchanged retry later succeeds',
      async () => {
        assert.equal((await inventory(adjustment('-70'))).status, 201);
        assert.equal(await balance(), '10');
        const key = randomUUID(),
          input = {
            expectedRevision: 3,
            reason: 'Correct first delivery receipt',
            reference: 'REV-1',
          };
        assert.equal(
          (await call('/receipts/' + first.receiptId + '/reverse', input, key)).status,
          409,
        );
        assert.equal((await progress()).receiptRevision, 3);
        assert.equal((await progress()).lines[0]!.received, '80');
        assert.equal((await inventory(adjustment('70'))).status, 201);
        const r = await call('/receipts/' + first.receiptId + '/reverse', input, key);
        assert.equal(r.status, 201);
        const saved = await r.json();
        assert.deepEqual(
          await (await call('/receipts/' + first.receiptId + '/reverse', input, key)).json(),
          saved,
        );
        state = await progress();
        assert.equal(state.receiptRevision, 4);
        assert.equal(state.lines[0]!.received, '50');
        assert.equal(await balance(), '50');
        assert.ok(state.items.find((row) => row.id === first.receiptId)?.reversedAt);
        assert.equal(
          (
            await call('/receipts/' + first.receiptId + '/reverse', {
              ...input,
              expectedRevision: 4,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'reversed document reference can be corrected, while active receipts prevent PO cancellation',
      async () => {
        const r = await call('/orders/' + order.id + '/receipts', body('10', 4, 'DOC-1'));
        assert.equal(r.status, 201);
        state = await progress();
        assert.equal(state.receiptRevision, 5);
        assert.equal(await balance(), '60');
        assert.equal(
          (
            await call('/orders/' + order.id + '/cancel', {
              expectedVersion: order.version,
              reason: 'Cannot cancel while goods remain received',
            })
          ).status,
          409,
        );
        const runtime = createRuntimeDataSource();
        await runtime.initialize();
        try {
          await assert.rejects(
            runtime.query(
              "UPDATE purchase_orders SET status='cancelled',cancellation_reason='Bypass attempt',cancelled_at=now(),version=version+1 WHERE id=$1",
              [order.id],
            ),
            /PURCHASE_RECEIPTS_EXIST/,
          );
        } finally {
          await runtime.destroy();
        }
      },
    );
    await t.test(
      'failed purchasing audit rolls back stock, receipt, revision and both retry records',
      async () => {
        const trigger = 'receipt_audit_fail_' + randomBytes(4).toString('hex'),
          key = randomUUID(),
          input = body('5', 5, 'DOC-AUDIT');
        try {
          await db.query(
            'CREATE FUNCTION "' +
              trigger +
              "\"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='purchasing.receipt_created' THEN RAISE EXCEPTION 'receipt audit fixture';END IF;RETURN NEW;END $$",
          );
          await db.query(
            'CREATE TRIGGER "' +
              trigger +
              '" BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION "' +
              trigger +
              '"()',
          );
          assert.equal((await call('/orders/' + order.id + '/receipts', input, key)).status, 500);
          assert.equal(await balance(), '60');
          assert.equal((await progress()).receiptRevision, 5);
          for (const table of ['inventory_requests', 'purchasing_requests'])
            assert.equal(
              (
                await db.query('SELECT count(*)::int AS n FROM ' + table + ' WHERE key=$1', [key])
              )[0].n,
              0,
            );
        } finally {
          await db.query('DROP TRIGGER IF EXISTS "' + trigger + '" ON audit_events');
          await db.query('DROP FUNCTION "' + trigger + '"()');
        }
        assert.equal((await call('/orders/' + order.id + '/receipts', input, key)).status, 201);
        state = await progress();
        assert.equal(state.receiptRevision, 6);
        assert.equal(await balance(), '65');
      },
    );
    await t.test(
      'location-scoped receiver needs global purchasing read; revocation blocks cached replay',
      async () => {
        await db.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2)', [
          users[2],
          roles[0],
        ]);
        for (const code of ['inventory.read', 'inventory.receive', 'purchasing.receive'])
          await db.query('INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)', [
            roles[1],
            code,
          ]);
        const other = randomUUID();
        await db.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
          other,
          prefix + '-OTHER',
          'Other receipt fixture location',
        ]);
        await db.query(
          'UPDATE staff_role_assignments SET location_id=$1 WHERE staff_id=$2 AND role_id=$3',
          [other, users[2], roles[1]],
        );
        assert.equal(
          (
            await call(
              '/orders/' + order.id + '/receipts',
              body('1', 6, 'WRONG-LOC'),
              randomUUID(),
              2,
            )
          ).status,
          403,
        );
        await db.query(
          'UPDATE staff_role_assignments SET location_id=$1 WHERE staff_id=$2 AND role_id=$3',
          [location, users[2], roles[1]],
        );
        await db.query('UPDATE purchasing_suppliers SET is_active=false WHERE id=$1', [
          supplier.id,
        ]);
        const key = randomUUID(),
          input = body('1', 6, 'SCOPED-1');
        assert.equal((await call('/orders/' + order.id + '/receipts', input, key, 2)).status, 201);
        state = await progress();
        assert.equal(state.receiptRevision, 7);
        assert.equal(await balance(), '66');
        await db.query(
          "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='purchasing.receive'",
          [roles[1]],
        );
        assert.equal((await call('/orders/' + order.id + '/receipts', input, key, 2)).status, 403);
      },
    );
    await t.test(
      'remaining stock can be completed, and every balance reconciles to immutable movements',
      async () => {
        assert.equal(
          (await call('/orders/' + order.id + '/receipts', body('34', 7, 'FINAL-1'))).status,
          201,
        );
        state = await progress();
        assert.equal(state.lines[0]!.received, '100');
        assert.equal(state.lines[0]!.remaining, '0');
        assert.equal(await balance(), '100');
        assert.equal((await call('/orders/' + order.id + '/receipts', body('1'))).status, 409);
        const ledger = (
          await db.query(
            'SELECT coalesce(sum(delta),0)::text AS n FROM inventory_entries WHERE location_id=$1 AND variant_id=$2',
            [location, variant],
          )
        )[0].n;
        assert.equal(await balance(), ledger);
      },
    );
    await t.test(
      'receipt migration refuses dropping history and restores delegated function privileges in an empty scratch rollback',
      async () => {
        const live = db.createQueryRunner();
        try {
          await assert.rejects(
            new PurchaseReceipts1794105000000().down(live),
            /Cannot discard posted purchase receipts/,
          );
        } finally {
          await live.release();
        }
        const r = db.createQueryRunner(),
          schema = 'receipt_probe_' + randomBytes(4).toString('hex'),
          role = decodeURIComponent(new URL(databaseUrl(process.env, 'DATABASE_URL')).username);
        assert.match(role, /^[a-z][a-z0-9_]+$/);
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
            new PurchasingFoundation1794104000000(),
          ])
            await migration.up(r);
          await r.query(
            'GRANT EXECUTE ON FUNCTION "' +
              schema +
              '".inventory_post(uuid,uuid,uuid,jsonb) TO "' +
              role +
              '"',
          );
          const migration = new PurchaseReceipts1794105000000();
          await migration.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 7);
          assert.equal(
            (
              await r.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [
                role,
                schema + '.inventory_post_core(uuid,uuid,uuid,jsonb)',
              ])
            )[0].allowed,
            false,
          );
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 6);
          assert.equal(
            (
              await r.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [
                role,
                schema + '.inventory_post(uuid,uuid,uuid,jsonb)',
              ])
            )[0].allowed,
            true,
          );
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
      },
    );
    await t.test(
      'reversing all active receipts reopens the quantity and permits cancellation without deleting history',
      async () => {
        state = await progress();
        for (const receipt of state.items.filter((r) => !r.reversedAt)) {
          const result = await call('/receipts/' + receipt.id + '/reverse', {
            expectedRevision: state.receiptRevision,
            reason: 'Complete disposable order rollback',
            reference: '',
          });
          assert.equal(result.status, 201);
          state = await progress();
        }
        assert.equal(await balance(), '0');
        assert.equal(state.lines[0]!.received, '0');
        assert.equal(state.lines[0]!.remaining, '100');
        assert.equal(state.hasActiveReceipts, false);
        assert.ok(state.total > 0);
        assert.equal(
          (
            await call('/orders/' + order.id + '/cancel', {
              expectedVersion: order.version,
              reason: 'All received goods reversed',
            })
          ).status,
          201,
        );
        assert.equal((await call('/orders/' + order.id + '/receipts', body('1'))).status, 409);
      },
    );
    await t.test(
      'multi-SKU receiving rolls back every line when a variant is inactive, then retries and reverses together',
      async () => {
        await db.query('UPDATE purchasing_suppliers SET is_active=true WHERE id=$1', [supplier.id]);
        const second = randomUUID();
        await db.query(
          "INSERT INTO catalog_variants(id,product_id,sku,attributes,options_key,price_minor) VALUES($1,$2,$3,'{}',$4,10000)",
          [second, product, prefix + '-L', 'c'.repeat(64)],
        );
        const made = await call('/orders', {
          ...orderBody(),
          lines: [
            { variantId: variant, quantity: '4', unitCost: '10.00' },
            { variantId: second, quantity: '8', unitCost: '20.00' },
          ],
        });
        assert.equal(made.status, 201);
        let extra: PurchaseOrder = await made.json();
        const issue = await call('/orders/' + extra.id + '/issue', {
          expectedVersion: extra.version,
        });
        assert.equal(issue.status, 201);
        extra = await issue.json();
        const details: ReceivingPage = await (
          await call('/orders/' + extra.id + '/receiving')
        ).json();
        const key = randomUUID(),
          input = {
            expectedRevision: 1,
            reason: 'Two-SKU delivery',
            reference: 'MULTI',
            lines: details.lines.map((l) => ({
              orderLineId: l.id,
              quantity: l.variantId === variant ? '1' : '3',
            })),
          };
        await db.query('UPDATE catalog_variants SET is_active=false WHERE id=$1', [second]);
        assert.equal((await call('/orders/' + extra.id + '/receipts', input, key)).status, 409);
        assert.equal(await balance(), '0');
        const rejected: ReceivingPage = await (
          await call('/orders/' + extra.id + '/receiving')
        ).json();
        assert.equal(rejected.receiptRevision, 1);
        assert.ok(rejected.lines.every((l) => l.received === '0'));
        assert.equal(rejected.total, 0);
        await db.query('UPDATE catalog_variants SET is_active=true WHERE id=$1', [second]);
        const received = await call('/orders/' + extra.id + '/receipts', input, key);
        assert.equal(received.status, 201);
        const saved: ReceiptResult = await received.json();
        assert.equal(await balance(), '1');
        assert.equal(
          (
            await db.query(
              'SELECT quantity::text AS n FROM inventory_balances WHERE location_id=$1 AND variant_id=$2',
              [location, second],
            )
          )[0].n,
          '3',
        );
        assert.equal(
          (
            await call('/receipts/' + saved.receiptId + '/reverse', {
              expectedRevision: 2,
              reason: 'Undo complete two-SKU delivery',
              reference: '',
            })
          ).status,
          201,
        );
        assert.equal(await balance(), '0');
        assert.equal(
          (
            await db.query(
              'SELECT quantity::text AS n FROM inventory_balances WHERE location_id=$1 AND variant_id=$2',
              [location, second],
            )
          )[0].n,
          '0',
        );
      },
    );
    await t.test('concurrent order cancellation and receipt cannot both succeed', async () => {
      const made = await call('/orders', {
        ...orderBody(),
        lines: [{ variantId: variant, quantity: '1', unitCost: '10.00' }],
      });
      assert.equal(made.status, 201);
      let extra: PurchaseOrder = await made.json();
      const issue = await call('/orders/' + extra.id + '/issue', {
        expectedVersion: extra.version,
      });
      assert.equal(issue.status, 201);
      extra = await issue.json();
      const details: ReceivingPage = await (
        await call('/orders/' + extra.id + '/receiving')
      ).json();
      const responses = await Promise.all([
        call('/orders/' + extra.id + '/cancel', {
          expectedVersion: extra.version,
          reason: 'Cancellation racing physical receipt',
        }),
        call('/orders/' + extra.id + '/receipts', {
          expectedRevision: 1,
          reason: 'Receipt racing cancellation',
          reference: 'RACE',
          lines: [{ orderLineId: details.lines[0]!.id, quantity: '1' }],
        }),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      const result: ReceivingPage = await (await call('/orders/' + extra.id + '/receiving')).json();
      if (result.hasActiveReceipts) {
        assert.equal(result.orderStatus, 'issued');
        assert.equal(
          (
            await call('/receipts/' + result.items[0]!.id + '/reverse', {
              expectedRevision: result.receiptRevision,
              reason: 'Undo race fixture',
              reference: '',
            })
          ).status,
          201,
        );
      } else assert.equal(result.orderStatus, 'cancelled');
      assert.equal(await balance(), '0');
    });
    await t.test(
      'paginated receipt history exposes older receipts and allows their safe reversal',
      async () => {
        const made = await call('/orders', {
          ...orderBody(),
          lines: [{ variantId: variant, quantity: '25', unitCost: '10.00' }],
        });
        assert.equal(made.status, 201);
        let extra: PurchaseOrder = await made.json();
        const issue = await call('/orders/' + extra.id + '/issue', {
          expectedVersion: extra.version,
        });
        assert.equal(issue.status, 201);
        extra = await issue.json();
        const detail: ReceivingPage = await (
          await call('/orders/' + extra.id + '/receiving')
        ).json();
        for (let i = 0; i < 21; i++) {
          const response = await call('/orders/' + extra.id + '/receipts', {
            expectedRevision: i + 1,
            reason: 'Batched partial delivery ' + (i + 1),
            reference: 'BATCH-' + i,
            lines: [{ orderLineId: detail.lines[0]!.id, quantity: '1' }],
          });
          assert.equal(response.status, 201);
        }
        const firstPage: ReceivingPage = await (
            await call('/orders/' + extra.id + '/receiving?page=1')
          ).json(),
          secondPage: ReceivingPage = await (
            await call('/orders/' + extra.id + '/receiving?page=2')
          ).json();
        assert.equal(firstPage.total, 21);
        assert.equal(firstPage.items.length, 20);
        assert.equal(secondPage.items.length, 1);
        assert.equal(secondPage.lines[0]!.received, '21');
        assert.equal(secondPage.receiptRevision, 22);
        const older = secondPage.items[0]!;
        assert.equal(
          (
            await call('/receipts/' + older.id + '/reverse', {
              expectedRevision: 22,
              reason: 'Correct an older paginated receipt',
              reference: '',
            })
          ).status,
          201,
        );
        const revised: ReceivingPage = await (
          await call('/orders/' + extra.id + '/receiving?page=2')
        ).json();
        assert.ok(revised.items[0]!.reversedAt);
        assert.equal(revised.lines[0]!.received, '20');
        assert.equal(await balance(), '20');
        assert.equal((await call('/orders/' + extra.id + '/receiving?page=0')).status, 400);
      },
    );
  } finally {
    if (app) await app.close();
    try {
      if (ready)
        await db.transaction(async (m) => {
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
