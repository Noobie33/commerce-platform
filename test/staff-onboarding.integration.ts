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
import { PasswordService } from '../src/modules/identity/password.service.js';
import { StaffOnboarding1794119000000 } from '../src/database/migrations/1794119000000-staff-onboarding.js';
import type { EnrollmentResult, EnrollmentView } from '../src/modules/identity/onboarding.types.js';
test('staff onboarding: owner step-up, one-time codes, private activation and retained account safety', async (t) => {
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
  const users = [randomUUID(), randomUUID(), randomUUID()],
    tokens = users.map(() => randomBytes(32).toString('base64url')),
    csrf = users.map(() => randomBytes(32).toString('hex')),
    suffix = randomBytes(4).toString('hex'),
    role = randomUUID(),
    readerRole = randomUUID(),
    subjects = new Set<string>(),
    names = new Set<string>(),
    ownerPassword = 'Disposable owner passphrase 2026',
    employeePassword = 'A separate employee passphrase 2026',
    passwords = new PasswordService(),
    ownerHash = await passwords.hash(ownerPassword),
    origin = 'http://onboarding.test';
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '';
  const headers = (who = 0) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: 'commerce_session=' + tokens[who],
    'X-CSRF-Token': csrf[who]!,
  });
  const request = (path: string, body?: unknown, who = 0, key = randomUUID()) =>
    fetch(base + '/api/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers(who), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const resetOwner = async () => {
    await db.query('DELETE FROM login_rate_limits WHERE bucket_hash=$1', [
      tokenHash('onboarding-owner:' + users[0]),
    ]);
  };
  const resetActivation = async () => {
    await db.query(
      'DELETE FROM login_rate_limits WHERE bucket_hash=$1 OR bucket_hash=ANY($2::text[])',
      [
        tokenHash('activation-ip:127.0.0.1'),
        [...names].map((n) => tokenHash('activation-user:' + n)),
      ],
    );
  };
  function creation() {
    const id = randomUUID(),
      username = 'onboard.' + suffix + '.' + subjects.size;
    subjects.add(id);
    names.add(username);
    return {
      action: 'create',
      id,
      expectedVersion: 0,
      username,
      displayName: 'Employee ' + subjects.size,
      reason: 'Join the retail team',
      ownerPassword,
    };
  }
  const post = (b: unknown, key = randomUUID(), who = 0) =>
    request('staff-onboarding', b, who, key);
  async function view(id: string) {
    const r = await request('staff-onboarding/' + id);
    assert.equal(r.status, 200);
    return r.json() as Promise<EnrollmentView>;
  }
  async function activate(username: string, code: string, password = employeePassword) {
    return request('auth/activate', { username, code, newPassword: password });
  }
  async function login(username: string, password: string) {
    return request('auth/login', { username, password });
  }
  let primary: ReturnType<typeof creation>, issued: EnrollmentResult, reissued: EnrollmentResult;
  try {
    for (let i = 0; i < users.length; i++) {
      await db.query(
        'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,$3,$4,false)',
        [users[i], 'enrollment.owner.' + suffix + i, 'Enrollment test owner ' + i, ownerHash],
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
    await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [
      role,
      'enrollment_delegate_' + suffix,
    ]);
    await db.query(
      "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'staff.manage')",
      [role],
    );
    await db.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2)', [
      users[1],
      role,
    ]);
    app = await createApp({ ...process.env, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    await t.test(
      'enrollment reads and writes require a real owner, CSRF and current password',
      async () => {
        primary = creation();
        assert.equal((await fetch(base + '/api/v1/staff-onboarding')).status, 401);
        assert.equal((await post(primary, randomUUID(), 1)).status, 403);
        assert.equal((await request('staff-onboarding', undefined, 1)).status, 403);
        const h = headers();
        delete (h as Partial<typeof h>)['X-CSRF-Token'];
        assert.equal(
          (
            await fetch(base + '/api/v1/staff-onboarding', {
              method: 'POST',
              headers: h,
              body: JSON.stringify(primary),
            })
          ).status,
          403,
        );
        assert.equal(
          (await post({ ...primary, ownerPassword: 'Incorrect owner password' })).status,
          403,
        );
        assert.equal(
          (await db.query('SELECT 1 FROM staff_users WHERE id=$1', [primary.id])).length,
          0,
        );
        for (const table of [
          'staff_onboarding',
          'staff_onboarding_events',
          'staff_onboarding_requests',
        ])
          await assert.rejects(runtime.query('DELETE FROM ' + table), /permission denied/);
        await assert.rejects(
          runtime.query('SELECT public.staff_access_post_v20($1,$2,$3,$4::jsonb)', [
            randomUUID(),
            users[0],
            randomUUID(),
            '{}',
          ]),
          /permission denied/,
        );
      },
    );
    await t.test(
      'creation starts with no roles or usable password and a code returned once, not stored',
      async () => {
        await resetOwner();
        const key = randomUUID(),
          r = await post(primary, key);
        assert.equal(r.status, 200);
        issued = await r.json();
        assert.equal(issued.activationCode?.length, 43);
        assert.equal(issued.activationUrl, origin + '/admin#activate');
        assert.equal(issued.activationUrl.includes(issued.activationCode!), false);
        const [u] = await db.query(
          'SELECT password_hash,must_change_password FROM staff_users WHERE id=$1',
          [primary.id],
        );
        assert.equal(u.password_hash, '!pending-enrollment');
        assert.equal(u.must_change_password, true);
        assert.equal(
          (await db.query('SELECT 1 FROM staff_role_assignments WHERE staff_id=$1', [primary.id]))
            .length,
          0,
        );
        assert.equal((await login(primary.username, ownerPassword)).status, 401);
        const [o] = await db.query('SELECT code_hash FROM staff_onboarding WHERE staff_id=$1', [
          primary.id,
        ]);
        assert.equal(o.code_hash, tokenHash(issued.activationCode!));
        for (const table of [
          'staff_onboarding_events',
          'staff_onboarding_requests',
          'audit_events',
        ]) {
          const rows = await db.query('SELECT to_jsonb(t)::text AS value FROM ' + table + ' t');
          assert.equal(JSON.stringify(rows).includes(issued.activationCode!), false);
          assert.equal(JSON.stringify(rows).includes(ownerPassword), false);
        }
        const replay = await post(primary, key);
        assert.equal(replay.status, 200);
        const data = await replay.json();
        assert.equal(data.activationCode, undefined);
        assert.equal(data.issued, false);
        assert.equal(data.replayed, true);
        assert.equal((await post({ ...primary, reason: 'Changed reason' }, key)).status, 409);
        assert.equal((await post(primary, key, 2)).status, 409);
      },
    );
    await t.test(
      'concurrent create retries reveal only one matching code and never create duplicate users',
      async () => {
        await resetOwner();
        const body = creation(),
          key = randomUUID(),
          replies = await Promise.all([post(body, key), post(body, key)]);
        assert.deepEqual(
          replies.map((r) => r.status),
          [200, 200],
        );
        const data = await Promise.all(replies.map((r) => r.json()));
        assert.equal(data.filter((r) => r.activationCode).length, 1);
        assert.equal(
          (await db.query('SELECT 1 FROM staff_users WHERE id=$1', [body.id])).length,
          1,
        );
        assert.equal((await view(body.id)).record.version, 1);
      },
    );
    await t.test(
      'reissue invalidates the prior code and stale revisions cannot overwrite it',
      async () => {
        await resetOwner();
        const r = await post({
          action: 'reissue',
          id: primary.id,
          expectedVersion: 1,
          reason: 'Lost original code',
          ownerPassword,
        });
        assert.equal(r.status, 200);
        reissued = await r.json();
        assert.notEqual(reissued.activationCode, issued.activationCode);
        assert.equal((await activate(primary.username, issued.activationCode!)).status, 400);
        assert.equal(
          (
            await post({
              action: 'reissue',
              id: primary.id,
              expectedVersion: 1,
              reason: 'Stale form',
              ownerPassword,
            })
          ).status,
          409,
        );
        assert.equal((await view(primary.id)).record.version, 2);
      },
    );
    await t.test(
      'anonymous activation requires origin, a complete code, and the same password policy',
      async () => {
        assert.equal(
          (
            await fetch(base + '/api/v1/auth/activate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: primary.username,
                code: reissued.activationCode,
                newPassword: employeePassword,
              }),
            })
          ).status,
          403,
        );
        assert.equal(
          (await activate(primary.username, reissued.activationCode!, 'short')).status,
          400,
        );
        const a = await activate('unknown.' + suffix, 'A'.repeat(43)),
          b = await activate(primary.username, 'A'.repeat(43));
        names.add('unknown.' + suffix);
        assert.equal(a.status, 400);
        assert.deepEqual(await a.json(), await b.json());
      },
    );
    await t.test(
      'one successful activation sets a personal hash, clears the code, revokes sessions and requires normal sign-in',
      async () => {
        const raw = randomBytes(32).toString('base64url');
        await db.query(
          'INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)',
          [primary.id, tokenHash(raw), randomBytes(32).toString('hex')],
        );
        const r = await activate(primary.username, reissued.activationCode!);
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { activated: true, loginRequired: true });
        assert.equal(r.headers.get('set-cookie'), null);
        const [u] = await db.query(
          'SELECT password_hash,must_change_password FROM staff_users WHERE id=$1',
          [primary.id],
        );
        assert.equal(await passwords.verify(employeePassword, u.password_hash), true);
        assert.equal(u.must_change_password, false);
        assert.equal(
          (
            await db.query('SELECT code_hash FROM staff_onboarding WHERE staff_id=$1', [primary.id])
          )[0].code_hash,
          null,
        );
        assert.equal(
          (
            await fetch(base + '/api/v1/staff/me', {
              headers: { Cookie: 'commerce_session=' + raw },
            })
          ).status,
          401,
        );
        assert.equal((await activate(primary.username, reissued.activationCode!)).status, 400);
        const logged = await login(primary.username, employeePassword);
        assert.equal(logged.status, 200);
        const cookie = logged.headers.get('set-cookie')!.split(';')[0]!;
        const self = await fetch(base + '/api/v1/staff/me', { headers: { Cookie: cookie } });
        const profile = await self.json();
        assert.deepEqual(profile.grants, []);
        assert.equal(profile.mustChangePassword, false);
      },
    );
    await t.test(
      'activated accounts and legacy owners cannot be repurposed as password reset targets',
      async () => {
        await resetOwner();
        assert.equal(
          (
            await post({
              action: 'reissue',
              id: primary.id,
              expectedVersion: 3,
              reason: 'Forbidden reset',
              ownerPassword,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await post({
              action: 'reissue',
              id: users[0],
              expectedVersion: 0,
              reason: 'Forbidden owner reset',
              ownerPassword,
            })
          ).status,
          404,
        );
        const [before] = await db.query('SELECT password_hash FROM staff_users WHERE id=$1', [
          users[0],
        ]);
        assert.equal(before.password_hash, ownerHash);
        assert.equal(
          (await post({ ...creation(), username: 'enrollment.owner.' + suffix + '0' })).status,
          409,
        );
      },
    );
    await t.test(
      'expiry and explicit revocation do not permit activation or resurrect passwords',
      async () => {
        await resetOwner();
        const body = creation(),
          r = await post(body);
        assert.equal(r.status, 200);
        const data = await r.json();
        await db.query(
          "UPDATE staff_onboarding SET expires_at=now()-interval '1 minute' WHERE staff_id=$1",
          [body.id],
        );
        assert.equal((await activate(body.username, data.activationCode)).status, 400);
        assert.equal((await view(body.id)).record.status, 'expired');
        assert.equal(
          (
            await post({
              action: 'revoke',
              id: body.id,
              expectedVersion: 1,
              reason: 'Withdraw invitation',
              ownerPassword,
            })
          ).status,
          200,
        );
        assert.equal((await activate(body.username, data.activationCode)).status, 400);
        assert.equal((await view(body.id)).record.state, 'revoked');
      },
    );
    await t.test(
      'disabling a pending account permanently revokes its code, including across access retries',
      async () => {
        await resetOwner();
        const b = creation(),
          r = await post(b),
          data = await r.json();
        const accessKey = randomUUID(),
          disabled = {
            kind: 'staff',
            id: b.id,
            expectedVersion: 0,
            displayName: b.displayName,
            active: false,
            assignments: [],
            reason: 'Disable pending employee',
          };
        assert.equal((await request('access', disabled, 0, accessKey)).status, 200);
        assert.equal((await view(b.id)).record.version, 2);
        assert.equal(
          (await request('access', { ...disabled, expectedVersion: 1, active: true }, 0)).status,
          200,
        );
        assert.equal((await activate(b.username, data.activationCode)).status, 400);
        const renewed = await post({
          action: 'reissue',
          id: b.id,
          expectedVersion: 2,
          reason: 'Reactivate enrollment',
          ownerPassword,
        });
        assert.equal(renewed.status, 200);
        const next = await renewed.json();
        assert.equal((await request('access', disabled, 0, accessKey)).status, 200);
        assert.equal((await view(b.id)).record.version, 3);
        assert.equal((await activate(b.username, next.activationCode)).status, 200);
      },
    );

    await t.test(
      'audit failure restores creation, activation, session revocation and retry state',
      async () => {
        await resetOwner();
        const b = creation(),
          r = await post(b),
          data = await r.json(),
          failedCreate = creation(),
          failedKey = randomUUID(),
          rawSession = randomBytes(32).toString('base64url');
        await db.query(
          'INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)',
          [b.id, tokenHash(rawSession), randomBytes(32).toString('hex')],
        );
        await db.query(
          "CREATE FUNCTION enrollment_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN('staff.onboarding_created','staff.onboarding_activated') THEN RAISE EXCEPTION 'forced activation audit';END IF;RETURN NEW;END;$$;CREATE TRIGGER enrollment_test_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION enrollment_test_fail();",
        );
        try {
          assert.equal((await post(failedCreate, failedKey)).status, 500);
          assert.equal(
            (await db.query('SELECT 1 FROM staff_users WHERE id=$1', [failedCreate.id])).length,
            0,
          );
          assert.equal(
            (await db.query('SELECT 1 FROM staff_onboarding_requests WHERE key=$1', [failedKey]))
              .length,
            0,
          );
          assert.equal((await activate(b.username, data.activationCode)).status, 500);
          assert.equal((await view(b.id)).record.state, 'pending');
          assert.equal(
            (await db.query('SELECT password_hash FROM staff_users WHERE id=$1', [b.id]))[0]
              .password_hash,
            '!pending-enrollment',
          );
          assert.equal(
            (
              await fetch(base + '/api/v1/staff/me', {
                headers: { Cookie: 'commerce_session=' + rawSession },
              })
            ).status,
            200,
          );
        } finally {
          await db.query(
            'DROP TRIGGER enrollment_test_fail ON audit_events;DROP FUNCTION enrollment_test_fail()',
          );
        }
        assert.equal((await post(failedCreate, failedKey)).status, 200);
        assert.equal((await activate(b.username, data.activationCode)).status, 200);
        assert.equal(
          (
            await fetch(base + '/api/v1/staff/me', {
              headers: { Cookie: 'commerce_session=' + rawSession },
            })
          ).status,
          401,
        );
      },
    );
    await t.test('concurrent activation consumes a code only once', async () => {
      await resetOwner();
      const b = creation(),
        r = await post(b),
        data = await r.json();
      const results = await Promise.all([
        activate(b.username, data.activationCode),
        activate(b.username, data.activationCode),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      assert.equal((await view(b.id)).record.version, 2);
    });

    await t.test(
      'prepared roles become usable only after activation and never confer owner access',
      async () => {
        await resetOwner();
        const b = creation(),
          r = await post(b),
          data = await r.json();
        assert.equal(
          (
            await request('access', {
              kind: 'role',
              id: readerRole,
              expectedVersion: 0,
              code: 'enrollment_reader_' + suffix,
              label: 'Catalog reader',
              active: true,
              permissions: ['catalog.read'],
              reason: 'Prepare limited employee access',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request('access', {
              kind: 'staff',
              id: b.id,
              expectedVersion: 0,
              displayName: b.displayName,
              active: true,
              assignments: [{ roleId: readerRole, locationId: null }],
              reason: 'Assign read-only catalog duties',
            })
          ).status,
          200,
        );
        assert.equal((await login(b.username, employeePassword)).status, 401);
        assert.equal((await activate(b.username, data.activationCode)).status, 200);
        const logged = await login(b.username, employeePassword);
        assert.equal(logged.status, 200);
        const cookie = logged.headers.get('set-cookie')!.split(';')[0]!,
          who = { Cookie: cookie };
        const self = await (await fetch(base + '/api/v1/staff/me', { headers: who })).json();
        assert.deepEqual(self.grants, [{ code: 'catalog.read', locationId: null }]);
        assert.equal(
          (await fetch(base + '/api/v1/catalog/products', { headers: who })).status,
          200,
        );
        assert.equal(
          (await fetch(base + '/api/v1/staff-onboarding', { headers: who })).status,
          403,
        );
      },
    );
    await t.test(
      'owner credential or session changes during step-up are rejected at SQL commit time',
      async () => {
        await resetOwner();
        const b = creation(),
          payload = { ...b } as Record<string, unknown>;
        delete payload.ownerPassword;
        await assert.rejects(
          runtime.query('SELECT public.staff_onboarding_owner_post($1,$2,$3,$4,$5,$6,$7::jsonb)', [
            randomUUID(),
            users[0],
            randomUUID(),
            randomUUID(),
            ownerHash,
            tokenHash('A'.repeat(43)),
            JSON.stringify(payload),
          ]),
          /ENROLLMENT_PERMISSION/,
        );
        const session = (
          await db.query('SELECT id FROM staff_sessions WHERE token_hash=$1', [
            tokenHash(tokens[0]!),
          ])
        )[0].id;
        await assert.rejects(
          runtime.query('SELECT public.staff_onboarding_owner_post($1,$2,$3,$4,$5,$6,$7::jsonb)', [
            randomUUID(),
            users[0],
            session,
            randomUUID(),
            'outdated-hash',
            tokenHash('A'.repeat(43)),
            JSON.stringify(payload),
          ]),
          /ENROLLMENT_PERMISSION/,
        );
        assert.equal((await db.query('SELECT 1 FROM staff_users WHERE id=$1', [b.id])).length, 0);
      },
    );
    await t.test(
      'owner reauthentication and anonymous activation attempts are rate limited without locking the account',
      async () => {
        await resetOwner();
        const b = creation();
        for (let i = 0; i < 10; i++)
          assert.equal((await post({ ...b, ownerPassword: 'incorrect password' })).status, 403);
        assert.equal((await post({ ...b, ownerPassword: 'incorrect password' })).status, 429);
        await resetOwner();
        await resetActivation();
        for (let i = 0; i < 30; i++) {
          const username = 'missing.' + suffix + '.' + i;
          names.add(username);
          assert.equal((await activate(username, 'B'.repeat(43))).status, 400);
        }
        assert.equal((await activate('missing.' + suffix + '.last', 'B'.repeat(43))).status, 429);
        await resetActivation();
      },
    );
    await t.test(
      'private lists expose status and history but never hashes, codes, passwords or sessions',
      async () => {
        await resetOwner();
        const r = await request('staff-onboarding?search=' + suffix);
        assert.equal(r.status, 200);
        const text = await r.text();
        for (const v of [
          'code_hash',
          'password_hash',
          ownerPassword,
          employeePassword,
          issued.activationCode!,
        ])
          assert.equal(text.includes(v), false);
        assert.equal((await (await request('staff-onboarding?search=%25')).json()).total, 0);
        assert.equal((await request('staff-onboarding?page=0')).status, 400);
        assert.equal(
          (await request('staff-onboarding/' + primary.id + '?page=1')).headers.get(
            'cache-control',
          ),
          'no-store',
        );
      },
    );
    await t.test(
      'migration preserves existing credentials and empty-schema reversal does not discard enrollment history',
      async () => {
        const r = db.createQueryRunner(),
          migration = new StaffOnboarding1794119000000();
        await r.connect();
        try {
          await assert.rejects(migration.down(r), /Cannot discard/);
          await r.startTransaction();
          const schema = 'enrollment_scratch_' + suffix;
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET LOCAL search_path TO ' + schema + ',public');
          for (const prior of db.migrations) {
            if (prior instanceof StaffOnboarding1794119000000) break;
            await prior.up(r);
          }
          await r.query(
            "INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,'legacy.owner','Existing owner','not-a-login-hash')",
            [users[0]],
          );
          const before = await r.query('SELECT to_jsonb(u) AS row FROM staff_users u');
          await migration.up(r);
          assert.deepEqual(await r.query('SELECT to_jsonb(u) AS row FROM staff_users u'), before);
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 20);
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
    const ids = [...users, ...subjects];
    await db.transaction(async (m) => {
      await m.query('DELETE FROM staff_onboarding_requests WHERE actor_id=ANY($1::uuid[])', [
        users,
      ]);
      await m.query('DELETE FROM staff_onboarding_events WHERE staff_id=ANY($1::uuid[])', [
        [...subjects],
      ]);
      await m.query('DELETE FROM staff_onboarding WHERE staff_id=ANY($1::uuid[])', [[...subjects]]);
      await m.query('DELETE FROM staff_access_requests WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_access_events WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_access_versions WHERE staff_id=ANY($1::uuid[])', [
        [...subjects],
      ]);
      await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM role_access_profiles WHERE role_id=$1', [readerRole]);
      await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [
        [role, readerRole],
      ]);
      await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [[role, readerRole]]);
      await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
        [...users]
          .map((id) => tokenHash('onboarding-owner:' + id))
          .concat(
            [...names].flatMap((n) => [tokenHash('activation-user:' + n), tokenHash('user:' + n)]),
            [tokenHash('activation-ip:127.0.0.1'), tokenHash('ip:127.0.0.1')],
          ),
      ]);
    });
    await db.destroy();
  }
});
