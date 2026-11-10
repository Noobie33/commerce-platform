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
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { StaffAccess1794118000000 } from '../src/database/migrations/1794118000000-staff-access.js';
import type { AccessInput, AccessView } from '../src/modules/staff-access/access.types.js';
test('staff access: owner protection, versioned roles, scope boundaries, revocation and retained history', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource();
  await db.initialize();
  await db.runMigrations();
  await grantRuntime(db, process.env);
  await runtime.initialize();
  const users = Array.from({ length: 4 }, () => randomUUID()),
    tokens = users.map(() => randomBytes(32).toString('base64url')),
    csrf = users.map(() => randomBytes(32).toString('hex')),
    suffix = randomBytes(4).toString('hex'),
    locations = [randomUUID(), randomUUID()],
    role = randomUUID(),
    globalRole = randomUUID(),
    legacy = randomUUID(),
    roles = new Set([role, globalRole, legacy]),
    origin = 'http://access.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '';
  const headers = (who = 0) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: 'commerce_session=' + tokens[who],
    'X-CSRF-Token': csrf[who]!,
  });
  const call = (path: string, body?: unknown, who = 0, key = randomUUID()) =>
    fetch(base + '/api/v1/access' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers(who), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const read = async (kind: string, id: string, page = 1) => {
    const r = await call('/' + kind + '/' + id + '?page=' + page);
    assert.equal(r.status, 200);
    return r.json() as Promise<AccessView>;
  };
  const roleBody = (id = role): AccessInput => ({
    kind: 'role',
    id,
    expectedVersion: 0,
    code: 'warehouse_' + suffix,
    label: 'Warehouse team',
    active: true,
    permissions: ['inventory.read', 'inventory.receive'],
    reason: 'Prepare location duties',
  });
  async function staff(extra: Partial<AccessInput> = {}, key = randomUUID()) {
    const v = await read('staff', users[3]!);
    return call(
      '',
      {
        kind: 'staff',
        id: users[3],
        expectedVersion: v.record.version,
        displayName: v.record.displayName,
        active: v.record.active,
        assignments: v.record.assignments?.map((a) => ({
          roleId: a.roleId,
          locationId: a.locationId,
        })),
        reason: 'Review staff access',
        ...extra,
      },
      0,
      key,
    );
  }
  async function freshSubjectSession() {
    const tok = randomBytes(32).toString('base64url');
    await db.query('INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)', [
      users[3],
      tokenHash(tok),
      randomBytes(32).toString('hex'),
    ]);
    return tok;
  }
  const me = (token: string) =>
    fetch(base + '/api/v1/staff/me', { headers: { Cookie: 'commerce_session=' + token } });
  try {
    for (let i = 0; i < users.length; i++) {
      await db.query(
        "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Access test staff','not-a-login-hash',false)",
        [users[i], 'access.test.' + suffix + i],
      );
      await db.query(
        'INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)',
        [users[i], tokenHash(tokens[i]!), csrf[i]],
      );
    }
    for (const id of [users[0], users[2]])
      await db.query(
        "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
        [id],
      );
    await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [legacy, 'legacy_' + suffix]);
    await db.query(
      "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'staff.manage'),($1,'roles.manage')",
      [legacy],
    );
    await db.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2)', [
      users[1],
      legacy,
    ]);
    for (let i = 0; i < 2; i++)
      await db.query('INSERT INTO locations(id,code,name) VALUES($1,$2,$3)', [
        locations[i],
        'ACCESS' + suffix.toUpperCase() + i,
        'Access location ' + i,
      ]);
    app = await createApp({ ...process.env, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const [owner] = await db.query("SELECT id FROM roles WHERE code='owner'");
    const ownerBefore = await db.query(
      'SELECT permission_code FROM role_permissions WHERE role_id=$1 ORDER BY permission_code',
      [owner.id],
    );
    await t.test(
      'anonymous callers and non-owner delegated admins cannot read or write access settings',
      async () => {
        assert.equal((await fetch(base + '/api/v1/access/role')).status, 401);
        assert.equal((await call('/policy', undefined, 1)).status, 403);
        assert.equal((await call('', roleBody(), 1)).status, 403);
        const h = headers();
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        assert.equal(
          (
            await fetch(base + '/api/v1/access', {
              method: 'POST',
              headers: h,
              body: JSON.stringify(roleBody()),
            })
          ).status,
          403,
        );
        for (const table of [
          'staff_access_events',
          'staff_access_versions',
          'role_access_profiles',
          'staff_access_requests',
          'access_permission_policy',
        ])
          await assert.rejects(runtime.query('DELETE FROM ' + table), /permission denied/);
      },
    );
    await t.test(
      'owner accounts and owner or reserved administrative roles remain protected',
      async () => {
        assert.equal((await read('staff', users[0]!)).record.protected, true);
        assert.equal(
          (
            await call('', {
              kind: 'staff',
              id: users[0],
              expectedVersion: 0,
              displayName: 'Changed owner',
              active: false,
              assignments: [],
              reason: 'Forbidden owner edit',
            })
          ).status,
          403,
        );
        assert.equal((await call('', { ...roleBody(owner.id), code: 'owner' })).status, 403);
        assert.equal(
          (await call('', { ...roleBody(legacy), code: 'legacy_' + suffix })).status,
          403,
        );
        assert.equal(
          (await staff({ assignments: [{ roleId: owner.id, locationId: null }] })).status,
          403,
        );
        const p = await (await call('/policy')).json();
        assert.equal(
          p.some((x: { code: string }) =>
            [
              'staff.manage',
              'roles.manage',
              'sales.price_override',
              'customers.credit.manage',
            ].includes(x.code),
          ),
          false,
        );
      },
    );
    let originalKey = randomUUID();
    await t.test(
      'concurrent identical role retries create one revision; other bodies or actors cannot reuse keys',
      async () => {
        const b = roleBody(),
          r = await Promise.all([call('', b, 0, originalKey), call('', b, 0, originalKey)]);
        assert.deepEqual(
          r.map((x) => x.status),
          [200, 200],
        );
        assert.deepEqual(await r[0]!.json(), await r[1]!.json());
        assert.equal((await read('role', role)).record.version, 1);
        assert.equal((await call('', { ...b, label: 'Other label' }, 0, originalKey)).status, 409);
        assert.equal((await call('', b, 2, originalKey)).status, 409);
        assert.equal(
          (
            await call('', {
              ...roleBody(globalRole),
              code: 'catalog_' + suffix,
              permissions: ['catalog.read'],
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'location assignment revokes existing sessions and authorizes only its selected location',
      async () => {
        assert.equal(
          (await staff({ assignments: [{ roleId: role, locationId: locations[0]! }] })).status,
          200,
        );
        assert.equal((await me(tokens[3]!)).status, 401);
        const token = await freshSubjectSession();
        assert.equal((await me(token)).status, 200);
        for (let i = 0; i < 2; i++) {
          const r = await fetch(base + '/api/v1/inventory/locations/' + locations[i] + '/stock', {
            headers: { Cookie: 'commerce_session=' + token },
          });
          assert.equal(r.status, i === 0 ? 200 : 403);
        }
        const value = await read('staff', users[3]!);
        assert.equal(value.record.assignments?.[0]?.locationLabel, 'Access location 0');
        assert.equal((await read('role', role)).record.assignedStaffCount, 1);
        assert.equal(JSON.stringify(value).includes('password'), false);
        assert.equal(JSON.stringify(value).includes('token_hash'), false);
      },
    );
    await t.test(
      'mixed global permissions cannot be assigned or expanded through a location role',
      async () => {
        assert.equal(
          (await staff({ assignments: [{ roleId: globalRole, locationId: locations[0]! }] }))
            .status,
          409,
        );
        assert.equal(
          (await call('', { ...roleBody(), expectedVersion: 1, permissions: ['catalog.read'] }))
            .status,
          409,
        );
        assert.equal((await read('role', role)).record.version, 1);
        assert.equal(
          (await call('', { ...roleBody(), expectedVersion: 1, active: false, permissions: [] }))
            .status,
          409,
        );
        await db.query('UPDATE locations SET is_active=false WHERE id=$1', [locations[1]]);
        assert.equal(
          (await staff({ assignments: [{ roleId: role, locationId: locations[1]! }] })).status,
          409,
        );
      },
    );
    await t.test(
      'global role permission edits revoke affected sessions but label-only edits do not',
      async () => {
        const token = await freshSubjectSession();
        assert.equal(
          (await call('', { ...roleBody(), expectedVersion: 1, label: 'Warehouse operators' }))
            .status,
          200,
        );
        assert.equal((await me(token)).status, 200);
        assert.equal(
          (
            await call('', {
              ...roleBody(),
              expectedVersion: 2,
              label: 'Warehouse operators',
              permissions: ['inventory.read'],
            })
          ).status,
          200,
        );
        assert.equal((await me(token)).status, 401);
      },
    );
    await t.test(
      'staff name changes preserve sessions; disabling and re-enabling never resurrects old sessions',
      async () => {
        const token = await freshSubjectSession();
        assert.equal((await staff({ displayName: 'Named warehouse staff' })).status, 200);
        assert.equal((await me(token)).status, 200);
        assert.equal((await staff({ active: false })).status, 200);
        assert.equal((await me(token)).status, 401);
        assert.equal((await staff({ active: true })).status, 200);
        assert.equal((await me(token)).status, 401);
        assert.equal((await staff({ expectedVersion: 0 })).status, 409);
      },
    );
    await t.test(
      'retirement requires removing assignments, clears permissions and retains old role history',
      async () => {
        assert.equal((await staff({ assignments: [] })).status, 200);
        assert.equal(
          (await call('', { ...roleBody(), expectedVersion: 3, active: false, permissions: [] }))
            .status,
          200,
        );
        assert.equal(
          (await staff({ assignments: [{ roleId: role, locationId: null }] })).status,
          403,
        );
        assert.equal((await read('role', role)).record.active, false);
        assert.equal((await read('role', role)).history.length, 4);
      },
    );
    await t.test(
      'failed audit rolls back grants, staff status, session revocation, history and retries',
      async () => {
        const id = randomUUID();
        roles.add(id);
        const key = randomUUID(),
          b = { ...roleBody(id), code: 'rollback_' + suffix };
        await db.query(
          "CREATE FUNCTION access_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN('access.role_saved','access.staff_saved') THEN RAISE EXCEPTION 'forced access audit';END IF;RETURN NEW;END;$$;CREATE TRIGGER access_test_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION access_test_fail();",
        );
        try {
          assert.equal((await call('', b, 0, key)).status, 500);
          assert.equal((await db.query('SELECT 1 FROM roles WHERE id=$1', [id])).length, 0);
          assert.equal(
            (await db.query('SELECT 1 FROM staff_access_requests WHERE key=$1', [key])).length,
            0,
          );
        } finally {
          await db.query(
            'DROP TRIGGER access_test_fail ON audit_events;DROP FUNCTION access_test_fail()',
          );
        }
        assert.equal((await call('', b, 0, key)).status, 200);
      },
    );
    await t.test('fresh action permission is required even for a cached owner replay', async () => {
      await db.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='roles.manage'",
        [owner.id],
      );
      try {
        assert.equal((await call('', roleBody(), 0, originalKey)).status, 403);
      } finally {
        await db.query(
          "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'roles.manage')",
          [owner.id],
        );
      }
      assert.deepEqual(
        await db.query(
          'SELECT permission_code FROM role_permissions WHERE role_id=$1 ORDER BY permission_code',
          [owner.id],
        ),
        ownerBefore,
      );
    });
    await t.test(
      'lists and history paginate, literal search is safe, and role codes are immutable',
      async () => {
        for (let i = 0; i < 21; i++) {
          const id = randomUUID();
          roles.add(id);
          await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [
            id,
            'extra_' + suffix + '_' + i,
          ]);
        }
        const a = await (await call('/role?search=' + suffix + '&page=1')).json(),
          b = await (await call('/role?search=' + suffix + '&page=2')).json();
        assert.equal(a.items.length, 20);
        assert.ok(b.items.length > 0);
        assert.equal((await (await call('/role?search=%25')).json()).total, 0);
        assert.equal((await call('/role?page=0')).status, 400);
        assert.equal(
          (
            await call('', {
              ...roleBody(globalRole),
              expectedVersion: 1,
              code: 'changed_' + suffix,
            })
          ).status,
          400,
        );
        for (let i = 1; i <= 21; i++)
          assert.equal(
            (
              await call('', {
                ...roleBody(globalRole),
                expectedVersion: i,
                code: 'catalog_' + suffix,
                label: 'Catalog ' + i,
                permissions: ['catalog.read'],
              })
            ).status,
            200,
          );
        assert.equal((await read('role', globalRole)).history.length, 20);
        assert.equal((await read('role', globalRole, 2)).history.length, 2);
      },
    );
    await t.test(
      'the migration preserves credentials and refuses discarding access history',
      async () => {
        const r = db.createQueryRunner(),
          migration = new StaffAccess1794118000000();
        await r.connect();
        try {
          await assert.rejects(migration.down(r), /Cannot discard/);
          await r.startTransaction();
          const schema = 'access_scratch_' + suffix;
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET LOCAL search_path TO ' + schema + ',public');
          for (const prior of db.migrations) {
            if (prior instanceof StaffAccess1794118000000) break;
            await prior.up(r);
          }
          await r.query(
            "INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,'unchanged','Existing staff','not-a-login-hash')",
            [users[3]],
          );
          const before = await r.query('SELECT to_jsonb(u) AS value FROM staff_users u');
          await migration.up(r);
          assert.deepEqual(await r.query('SELECT to_jsonb(u) AS value FROM staff_users u'), before);
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 19);
          await migration.up(r);
          await r.rollbackTransaction();
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
      },
    );
  } finally {
    await app?.close();
    await runtime.destroy();
    await db.transaction(async (m) => {
      await m.query('DELETE FROM staff_access_requests WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_access_events WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_access_versions WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM role_access_profiles WHERE role_id=ANY($1::uuid[])', [[...roles]]);
      await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [[...roles]]);
      await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [[...roles]]);
      await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM locations WHERE id=ANY($1::uuid[])', [locations]);
    });
    await db.destroy();
  }
});
