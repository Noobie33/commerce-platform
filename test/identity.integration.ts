import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createDataSource, databaseUrl } from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { IdentityFoundation1794096000000 } from '../src/database/migrations/1794096000000-identity-foundation.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';

test('staff identity: real PostgreSQL security and transactional audit', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const source = createDataSource();
  await source.initialize();
  const prefix = 'it_' + randomBytes(6).toString('hex');
  const usernames = [
    prefix + '_owner',
    prefix + '_forced',
    prefix + '_scoped',
    prefix + '_missing',
  ];
  const password = 'Integration staff password 123!';
  const replacement = 'Replacement staff password 456!';
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const locations = [randomUUID(), randomUUID()];
  const roleId = randomUUID();
  const requestIds = new Set<string>();
  const ipBuckets = ['ip:127.0.0.1', 'ip:::ffff:127.0.0.1'].map(tokenHash);
  const rateBuckets = [
    ...ipBuckets,
    ...usernames.map((name) => tokenHash('user:' + name)),
    ...ids.map((id) => tokenHash('password-change:' + id)),
  ];
  const env = { ...process.env, STAFF_ORIGIN: 'http://staff.test' };
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let base = '';
  let schemaReady = false;
  const headers = {
    Origin: env.STAFF_ORIGIN,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
  };
  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(base + path, options);
    const id = response.headers.get('x-request-id');
    if (id) requestIds.add(id);
    return response;
  }
  async function login(username = usernames[0]!, value = password) {
    const response = await request('/api/v1/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password: value }),
    });
    const data = await response.json();
    return {
      response,
      data,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
      csrf: String(data.csrfToken ?? ''),
    };
  }
  const authHeaders = (session: { cookie: string; csrf: string }) => ({
    ...headers,
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrf,
  });
  try {
    await source.runMigrations();
    assert.equal((await source.runMigrations()).length, 0);
    await grantRuntime(source, process.env);
    schemaReady = true;
    await source.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
      rateBuckets,
    ]);
    const hash = await new PasswordService().hash(password);
    await source.transaction(async (manager) => {
      for (let i = 0; i < 3; i++) {
        await manager.query(
          'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES ($1,$2,$3,$4,$5)',
          [ids[i], usernames[i], 'Integration staff', hash, i === 1],
        );
      }
      for (let i = 0; i < 2; i++)
        await manager.query('INSERT INTO locations(id,code,name) VALUES ($1,$2,$3)', [
          locations[i],
          (prefix + '_' + i).toUpperCase(),
          'Test location',
        ]);
      await manager.query('INSERT INTO roles(id,code) VALUES ($1,$2)', [roleId, prefix + '_role']);
      await manager.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES ($1,'locations.read'),($1,'staff.read')",
        [roleId],
      );
      for (const id of ids.slice(0, 2))
        await manager.query(
          "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
          [id],
        );
      await manager.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES ($1,$2,$3)',
        [ids[2], roleId, locations[0]],
      );
    });
    app = await createApp(env);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();

    await t.test('unauthenticated/forged sessions and cross-origin login fail', async () => {
      assert.equal((await request('/api/v1/staff/me')).status, 401);
      assert.equal(
        (
          await request('/api/v1/staff/me', {
            headers: { Cookie: 'commerce_session=' + randomBytes(32).toString('base64url') },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request('/api/v1/auth/login', {
            method: 'POST',
            headers: { ...headers, Origin: 'http://evil.test' },
            body: '{}',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/api/v1/auth/login', {
            method: 'POST',
            headers,
            body: JSON.stringify({ username: usernames[0], password, unexpected: true }),
          })
        ).status,
        400,
      );
      const missing = await login(usernames[3]);
      const wrong = await login(usernames[0], 'incorrect');
      assert.equal(missing.response.status, 401);
      assert.equal(wrong.response.status, 401);
      assert.deepEqual(missing.data, wrong.data);
    });

    await t.test(
      'login uses protected cookie/hash storage; logout requires CSRF and revokes',
      async () => {
        const session = await login();
        assert.equal(session.response.status, 200);
        const cookie = session.response.headers.get('set-cookie')!;
        assert.ok(
          cookie.includes('HttpOnly') &&
            cookie.includes('SameSite=Strict') &&
            cookie.includes('Path=/'),
        );
        assert.equal(session.response.headers.get('cache-control'), 'no-store');
        const rawToken = session.cookie.split('=')[1]!;
        const stored = await source.query(
          'SELECT token_hash FROM staff_sessions WHERE staff_id=$1',
          [ids[0]],
        );
        assert.ok(
          stored.some((row: { token_hash: string }) => row.token_hash === tokenHash(rawToken)),
        );
        assert.ok(stored.every((row: { token_hash: string }) => row.token_hash !== rawToken));
        const me = await request('/api/v1/staff/me', { headers: { Cookie: session.cookie } });
        assert.equal(me.status, 200);
        assert.equal((await me.text()).includes('password_hash'), false);
        assert.equal(
          (await request('/api/v1/staff/me', { headers: { Authorization: 'Bearer ' + rawToken } }))
            .status,
          401,
        );
        assert.equal(
          (
            await request('/api/v1/staff/me', {
              headers: { Cookie: session.cookie + '; ' + session.cookie },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request('/api/v1/auth/logout', {
              method: 'POST',
              headers: { ...headers, Cookie: session.cookie },
              body: '{}',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request('/api/v1/auth/logout', {
              method: 'POST',
              headers: authHeaders(session),
              body: '{}',
            })
          ).status,
          200,
        );
        assert.equal(
          (await request('/api/v1/staff/me', { headers: { Cookie: session.cookie } })).status,
          401,
        );
      },
    );

    await t.test('initial password change is enforced and revokes every session', async () => {
      const first = await login(usernames[1]);
      const second = await login(usernames[1]);
      assert.equal(first.response.status, 200);
      assert.equal(
        (await request('/api/v1/staff/me', { headers: { Cookie: first.cookie } })).status,
        200,
      );
      assert.equal(
        (await request('/api/v1/staff', { headers: { Cookie: first.cookie } })).status,
        403,
      );
      assert.equal(
        (
          await request('/api/v1/auth/password', {
            method: 'POST',
            headers: authHeaders(first),
            body: JSON.stringify({ currentPassword: password, newPassword: replacement }),
          })
        ).status,
        200,
      );
      for (const cookie of [first.cookie, second.cookie])
        assert.equal(
          (await request('/api/v1/staff/me', { headers: { Cookie: cookie } })).status,
          401,
        );
      assert.equal((await login(usernames[1], password)).response.status, 401);
      const changed = await login(usernames[1], replacement);
      assert.equal(changed.response.status, 200);
      assert.equal(changed.data.user.mustChangePassword, false);
    });

    await t.test(
      'location-scoped role cannot cross locations or authorize a global staff list',
      async () => {
        const session = await login(usernames[2]);
        const get = (path: string) => request(path, { headers: { Cookie: session.cookie } });
        assert.equal((await get('/api/v1/locations/' + locations[0])).status, 200);
        assert.equal((await get('/api/v1/locations/' + locations[1])).status, 403);
        assert.equal((await get('/api/v1/staff')).status, 403);
        await source.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [ids[2]]);
        assert.equal((await get('/api/v1/locations/' + locations[0])).status, 403);
        await source.query(
          'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES ($1,$2,$3)',
          [ids[2], roleId, locations[0]],
        );
      },
    );

    await t.test(
      'expiry, idle timeout, revocation and deactivation reject existing cookies',
      async () => {
        for (const scenario of ['expiry', 'idle', 'revoke', 'deactivate']) {
          const session = await login();
          assert.equal(session.response.status, 200);
          const hash = tokenHash(session.cookie.split('=')[1]!);
          if (scenario === 'expiry')
            await source.query(
              "UPDATE staff_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE token_hash=$1",
              [hash],
            );
          if (scenario === 'idle')
            await source.query(
              "UPDATE staff_sessions SET last_seen_at=now()-interval '31 minutes' WHERE token_hash=$1",
              [hash],
            );
          if (scenario === 'revoke')
            await source.query('UPDATE staff_sessions SET revoked_at=now() WHERE token_hash=$1', [
              hash,
            ]);
          if (scenario === 'deactivate')
            await source.query('UPDATE staff_users SET is_active=false WHERE id=$1', [ids[0]]);
          assert.equal(
            (await request('/api/v1/staff/me', { headers: { Cookie: session.cookie } })).status,
            401,
          );
          await source.query('UPDATE staff_users SET is_active=true WHERE id=$1', [ids[0]]);
        }
      },
    );

    await t.test(
      'audit failure rolls back session creation rather than issuing a login',
      async () => {
        const before = await source.query(
          'SELECT count(*)::int AS total FROM staff_sessions WHERE staff_id=$1',
          [ids[0]],
        );
        await source.query(
          `CREATE FUNCTION identity_audit_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Intentional audit failure'; END; $$`,
        );
        try {
          await source.query(
            "CREATE TRIGGER identity_audit_failure_probe BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.action='staff.login') EXECUTE FUNCTION identity_audit_failure_probe()",
          );
          assert.equal((await login()).response.status, 500);
          const after = await source.query(
            'SELECT count(*)::int AS total FROM staff_sessions WHERE staff_id=$1',
            [ids[0]],
          );
          assert.equal(after[0].total, before[0].total);
        } finally {
          await source.query('DROP TRIGGER IF EXISTS identity_audit_failure_probe ON audit_events');
          await source.query('DROP FUNCTION identity_audit_failure_probe()');
        }
      },
    );

    await t.test(
      'runtime audit is append-only and contains no passwords/session secrets',
      async () => {
        const runtime = (
          await import('../src/infrastructure/database/data-source.js')
        ).createRuntimeDataSource();
        try {
          await runtime.initialize();
          for (const sql of [
            'UPDATE audit_events SET action=action',
            'DELETE FROM audit_events',
            'TRUNCATE audit_events',
          ]) {
            await assert.rejects(runtime.query(sql), { code: '42501' });
          }
          const events = await source.query(
            'SELECT action,metadata FROM audit_events WHERE actor_id=ANY($1::uuid[])',
            [ids],
          );
          const serialized = JSON.stringify(events);
          assert.equal(serialized.includes(password), false);
          assert.equal(serialized.includes(replacement), false);
          assert.equal(serialized.includes('password_hash'), false);
          assert.ok(
            events.some((event: { action: string }) => event.action === 'staff.password_changed'),
          );
        } finally {
          if (runtime.isInitialized) await runtime.destroy();
        }
      },
    );

    await t.test(
      'normalized Unicode passwords work at the maximum allowed character count',
      async () => {
        const session = await login(usernames[2]);
        assert.equal(session.response.status, 200);
        const change = await request('/api/v1/auth/password', {
          method: 'POST',
          headers: authHeaders(session),
          body: JSON.stringify({ currentPassword: password, newPassword: '\u00e9'.repeat(128) }),
        });
        assert.equal(change.status, 200);
        assert.equal((await login(usernames[2], 'e\u0301'.repeat(128))).response.status, 200);
      },
    );

    await t.test('HTTPS deployment policy produces a host-only Secure session cookie', async () => {
      const secureApp = await createApp({
        ...process.env,
        NODE_ENV: 'production',
        STAFF_ORIGIN: 'https://staff.test',
      });
      try {
        await secureApp.listen(0, '127.0.0.1');
        const secureBase = await secureApp.getUrl();
        const response = await fetch(secureBase + '/api/v1/auth/login', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://staff.test' },
          body: JSON.stringify({ username: usernames[0], password }),
        });
        const requestId = response.headers.get('x-request-id');
        if (requestId) requestIds.add(requestId);
        assert.equal(response.status, 200);
        const cookie = response.headers.get('set-cookie')!;
        assert.ok(cookie.startsWith('__Host-commerce_session='));
        assert.ok(
          cookie.includes('; Secure') &&
            cookie.includes('; HttpOnly') &&
            cookie.includes('; Path=/'),
        );
        assert.equal(cookie.includes('Domain='), false);
      } finally {
        await secureApp.close();
      }
    });
    await t.test(
      'persistent IP throttle rejects even correct credentials above the limit',
      async () => {
        await source.query(
          'UPDATE login_rate_limits SET attempts=30 WHERE bucket_hash=ANY($1::text[])',
          [ipBuckets],
        );
        assert.equal((await login()).response.status, 429);
      },
    );

    await t.test(
      'constraints reject duplicate global grants and orphaned assignments',
      async () => {
        await assert.rejects(
          source.transaction(async (manager) => {
            await manager.query(
              "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
              [ids[0]],
            );
          }),
          { code: '23505' },
        );
        await assert.rejects(
          source.transaction(async (manager) => {
            await manager.query(
              'INSERT INTO staff_role_assignments(staff_id,role_id) VALUES ($1,$2)',
              [randomUUID(), roleId],
            );
          }),
          { code: '23503' },
        );
      },
    );

    await t.test(
      'initial identity migration applies and reverts in an isolated scratch schema',
      async () => {
        const runner = source.createQueryRunner();
        const schema = 'identity_probe_' + randomBytes(6).toString('hex');
        try {
          await runner.startTransaction();
          await runner.query('CREATE SCHEMA "' + schema + '"');
          await runner.query('SET LOCAL search_path TO "' + schema + '", pg_catalog');
          const migration = new IdentityFoundation1794096000000();
          await migration.up(runner);
          assert.equal(
            (await runner.query('SELECT count(*)::int AS total FROM roles'))[0].total,
            1,
          );
          await migration.down(runner);
          assert.equal(
            (await runner.query("SELECT to_regclass('staff_users') AS name"))[0].name,
            null,
          );
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );
  } finally {
    try {
      if (app) await app.close();
      if (schemaReady)
        await source.transaction(async (manager) => {
          await manager.query(
            'DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[]) OR request_id=ANY($2::uuid[])',
            [ids, [...requestIds]],
          );
          await manager.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [ids]);
          await manager.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [
            ids,
          ]);
          await manager.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [ids]);
          await manager.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId]);
          await manager.query('DELETE FROM roles WHERE id=$1', [roleId]);
          await manager.query('DELETE FROM locations WHERE id=ANY($1::uuid[])', [locations]);
          await manager.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
            rateBuckets,
          ]);
        });
    } finally {
      if (source.isInitialized) await source.destroy();
    }
  }
});
