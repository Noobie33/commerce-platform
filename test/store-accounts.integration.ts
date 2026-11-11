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
import { StoreAccounts1794125000000 } from '../src/database/migrations/1794125000000-store-accounts.js';
import { IdentityFoundation1794096000000 } from '../src/database/migrations/1794096000000-identity-foundation.js';
import { openStorefrontFixture } from './storefront.acceptance.js';
import { customerCookieName } from '../apps/storefront/src/lib/account-contract.js';
test('customer accounts: isolated sessions, staff separation and actual Next.js cookie boundary', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource(),
    runtime = createRuntimeDataSource(),
    ids = [randomUUID(), randomUUID(), randomUUID()],
    prefix = 'account_' + randomBytes(5).toString('hex'),
    emails = ids.map((_, i) => prefix + i + '@example.invalid'),
    password = 'Customer integration password 123!',
    staff = randomUUID(),
    staffToken = randomBytes(32).toString('base64url'),
    staffCookie = 'commerce_session=' + staffToken,
    env = { ...process.env, CUSTOMER_ACCOUNT_MODE: 'preview', STAFF_ORIGIN: 'http://staff.test' };
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    closed: Awaited<ReturnType<typeof createApp>> | undefined,
    api = '';
  const requestIds = new Set<string>();
  const emailBuckets = [
      ...emails,
      prefix + 'missing@example.invalid',
      prefix + 'throttle@example.invalid',
    ].map((e) => tokenHash('customer:email:' + e)),
    sourceBuckets = ['127.0.0.1', '::ffff:127.0.0.1'].map((e) => tokenHash('customer:source:' + e));
  await db.initialize();
  await db.runMigrations();
  await grantRuntime(db, env);
  await runtime.initialize();
  try {
    const hash = await new PasswordService().hash(password);
    for (let i = 0; i < 3; i++)
      await db.query(
        'INSERT INTO store_customer_accounts(id,email,display_name,password_hash,is_active)VALUES($1,$2,$3,$4,$5)',
        [ids[i], emails[i], 'Customer ' + i, hash, i !== 2],
      );
    await db.query(
      "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password)VALUES($1,$2,'Separate staff',$3,false)",
      [staff, prefix, hash],
    );
    await db.query('INSERT INTO staff_sessions(staff_id,token_hash,csrf_token)VALUES($1,$2,$3)', [
      staff,
      tokenHash(staffToken),
      'a'.repeat(64),
    ]);
    await db.query('DELETE FROM store_customer_login_limits WHERE bucket_hash=ANY($1::text[])', [
      sourceBuckets,
    ]);
    app = await createApp(env);
    const observed: { path: string; cookie: boolean; authorization: boolean }[] = [];
    app.use(
      (
        req: { url: string; requestId: string; headers: Record<string, string> },
        _res: unknown,
        next: () => void,
      ) => {
        if (req.requestId) requestIds.add(req.requestId);
        if (req.url.startsWith('/api/v1/store/account'))
          observed.push({
            path: req.url,
            cookie: !!req.headers.cookie,
            authorization: !!req.headers.authorization,
          });
        next();
      },
    );
    await app.listen(0, '127.0.0.1');
    api = await app.getUrl();
    const base = api + '/api/v1/store/account',
      h = {
        Origin: api,
        'Content-Type': 'application/json',
        'X-Requested-With': 'commerce-store-server',
      },
      login = (email = emails[0]!, value = password, extra = {}) =>
        fetch(base + '/login', {
          method: 'POST',
          headers: { ...h, ...extra },
          body: JSON.stringify({ email, password: value }),
        }),
      session = (token: string) =>
        fetch(base + '/session', { headers: { 'X-Customer-Session': token } }),
      logout = (token: string, csrf: string) =>
        fetch(base + '/logout', {
          method: 'POST',
          headers: { ...h, 'X-Customer-Session': token, 'X-Customer-Csrf': csrf },
          body: '{}',
        });
    let token = '',
      other = '',
      csrf = '';
    await t.test(
      'public registration/recovery are absent and customer preview is closed by default',
      async () => {
        closed = await createApp({ ...env, CUSTOMER_ACCOUNT_MODE: 'closed' });
        await closed.listen(0, '127.0.0.1');
        const origin = await closed.getUrl();
        assert.deepEqual(await (await fetch(origin + '/api/v1/store/account/status')).json(), {
          mode: 'closed',
          registration: false,
          recovery: false,
        });
        assert.equal(
          (
            await fetch(origin + '/api/v1/store/account/login', {
              method: 'POST',
              headers: { ...h, Origin: origin },
              body: JSON.stringify({ email: emails[0], password }),
            })
          ).status,
          503,
        );
        assert.equal(
          (await fetch(base + '/register', { method: 'POST', headers: h, body: '{}' })).status,
          404,
        );
        assert.equal(
          (await fetch(base + '/recovery', { method: 'POST', headers: h, body: '{}' })).status,
          404,
        );
        await closed.close();
        closed = undefined;
      },
    );
    await t.test(
      'request boundary rejects foreign origins, missing headers and staff authentication reuse',
      async () => {
        assert.equal(
          (await login(emails[0], password, { Origin: 'http://foreign.test' })).status,
          403,
        );
        assert.equal((await login(emails[0], password, { 'X-Requested-With': '' })).status, 403);
        assert.equal(
          (await login(emails[0], password, { 'Content-Type': 'text/plain' })).status,
          403,
        );
        assert.equal(
          (
            await fetch(base + '/session', {
              headers: { Cookie: staffCookie, Authorization: 'Bearer ' + staffToken },
            })
          ).status,
          401,
        );
        assert.equal((await fetch(base + '/session?accountId=' + ids[0])).status, 400);
        assert.equal(
          (
            await fetch(api + '/api/v1/auth/login', {
              method: 'POST',
              headers: h,
              body: JSON.stringify({ username: prefix, password }),
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'unknown, incorrect and inactive accounts receive the same generic credential error',
      async () => {
        const replies = [];
        for (const [email, value] of [
          [emails[0], password + 'bad'],
          [prefix + 'missing@example.invalid', password],
          [emails[2], password],
        ]) {
          const r = await login(email, value);
          assert.equal(r.status, 401);
          replies.push(await r.json());
        }
        assert.deepEqual(replies, [
          { code: 'CUSTOMER_INVALID_CREDENTIALS' },
          { code: 'CUSTOMER_INVALID_CREDENTIALS' },
          { code: 'CUSTOMER_INVALID_CREDENTIALS' },
        ]);
      },
    );
    await t.test(
      'login stores only a token hash and session reads expose the correct customer',
      async () => {
        const r = await login();
        assert.equal(r.status, 200);
        token = (await r.json()).token;
        assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        const [s] = await db.query(
          'SELECT token_hash FROM store_customer_sessions WHERE token_hash=$1',
          [tokenHash(token)],
        );
        assert.notEqual(s.token_hash, token);
        const beforeCount = (
          await db.query('SELECT count(*)::int AS n FROM store_customer_sessions')
        )[0].n;
        await assert.rejects(
          runtime.query('SELECT public.store_customer_session_create($1,$2,$3,$4,$5)', [
            ids[0],
            'obsolete-password-hash',
            tokenHash(randomBytes(32).toString('base64url')),
            'a'.repeat(64),
            randomUUID(),
          ]),
        );
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM store_customer_sessions'))[0].n,
          beforeCount,
        );
        const v = await (await session(token)).json();
        assert.deepEqual(v.account, { displayName: 'Customer 0', email: emails[0] });
        csrf = v.csrfToken;
        assert.match(csrf, /^[a-f0-9]{64}$/);
        other = (await (await login(emails[1])).json()).token;
        assert.equal(
          (
            await fetch(api + '/api/v1/staff/me', {
              headers: { Cookie: 'commerce_session=' + token },
            })
          ).status,
          401,
        );
        assert.equal(
          (await fetch(api + '/api/v1/staff/me', { headers: { Cookie: staffCookie } })).status,
          200,
        );
      },
    );
    await t.test(
      'idle expiry, absolute expiry, revocation and deactivation close existing sessions',
      async () => {
        const hash = tokenHash(token);
        await db.query(
          "UPDATE store_customer_sessions SET last_seen_at=now()-interval '31 minutes' WHERE token_hash=$1",
          [hash],
        );
        assert.equal((await session(token)).status, 401);
        await db.query(
          "UPDATE store_customer_sessions SET last_seen_at=now(),created_at=now()-interval '9 hours',expires_at=now()-interval '1 minute' WHERE token_hash=$1",
          [hash],
        );
        assert.equal((await session(token)).status, 401);
        await db.query(
          "UPDATE store_customer_sessions SET expires_at=now()+interval '8 hours',revoked_at=now() WHERE token_hash=$1",
          [hash],
        );
        assert.equal((await session(token)).status, 401);
        await db.query('UPDATE store_customer_sessions SET revoked_at=NULL WHERE token_hash=$1', [
          hash,
        ]);
        await db.query('UPDATE store_customer_accounts SET is_active=false WHERE id=$1', [ids[0]]);
        assert.equal((await session(token)).status, 401);
        await db.query('UPDATE store_customer_accounts SET is_active=true WHERE id=$1', [ids[0]]);
        assert.equal((await session(token)).status, 200);
      },
    );
    await t.test(
      'logout checks customer CSRF, is idempotent and does not revoke another customer',
      async () => {
        assert.equal((await logout(token, 'b'.repeat(64))).status, 403);
        assert.equal((await session(token)).status, 200);
        const rs = await Promise.all([logout(token, csrf), logout(token, csrf)]);
        assert.deepEqual(
          rs.map((r) => r.status),
          [200, 200],
        );
        assert.equal((await session(token)).status, 401);
        assert.equal((await session(other)).status, 200);
        assert.equal(
          (
            await db.query(
              "SELECT 1 FROM store_customer_events WHERE account_id=$1 AND action='logout'",
              [ids[0]],
            )
          ).length,
          1,
        );
      },
    );
    await t.test(
      'audit failure rolls back login rather than leaving an unaudited session',
      async () => {
        const fn = 'customer_audit_' + randomBytes(5).toString('hex'),
          before = (await db.query('SELECT count(*)::int AS n FROM store_customer_sessions'))[0].n;
        try {
          await db.query(
            'CREATE FUNCTION ' +
              fn +
              "()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='login' THEN RAISE EXCEPTION 'test audit failure';END IF;RETURN NEW;END $$",
          );
          await db.query(
            'CREATE TRIGGER ' +
              fn +
              ' BEFORE INSERT ON store_customer_events FOR EACH ROW EXECUTE FUNCTION ' +
              fn +
              '()',
          );
          assert.equal((await login()).status, 500);
          assert.equal(
            (await db.query('SELECT count(*)::int AS n FROM store_customer_sessions'))[0].n,
            before,
          );
        } finally {
          await db.query('DROP TRIGGER IF EXISTS ' + fn + ' ON store_customer_events');
          await db.query('DROP FUNCTION IF EXISTS ' + fn + '()');
        }
      },
    );
    await t.test(
      'runtime cannot provision accounts, change credentials or rewrite customer auth history',
      async () => {
        await assert.rejects(runtime.query('UPDATE store_customer_accounts SET is_active=true'), {
          code: '42501',
        });
        await assert.rejects(runtime.query('DELETE FROM store_customer_events'), { code: '42501' });
        await assert.rejects(
          runtime.query('UPDATE store_customer_events SET request_id=gen_random_uuid()'),
          { code: '42501' },
        );
        const events = await db.query(
          'SELECT to_jsonb(e)::text AS value FROM store_customer_events e WHERE account_id=ANY($1::uuid[])',
          [ids],
        );
        for (const e of events) {
          assert.ok(!e.value.includes(password));
          assert.ok(!e.value.includes(token));
          assert.ok(!e.value.includes(csrf));
        }
      },
    );
    await t.test(
      'persistent per-email throttling limits repeated attempts without exposing account existence',
      async () => {
        const email = prefix + 'throttle@example.invalid';
        for (let i = 0; i < 15; i++) assert.equal((await login(email)).status, 401);
        assert.equal((await login(email)).status, 429);
        await db.query(
          'DELETE FROM store_customer_login_limits WHERE bucket_hash=ANY($1::text[])',
          [sourceBuckets],
        );
      },
    );
    await t.test(
      'actual Next.js sign-in keeps credentials server-side and drops staff cookies and authorization',
      async () => {
        const front = await openStorefrontFixture(t, api),
          headers = {
            Origin: front,
            'X-Requested-With': 'commerce-store',
            'Content-Type': 'application/json',
            Cookie: staffCookie,
            Authorization: 'Bearer ' + staffToken,
          };
        observed.length = 0;
        let r = await fetch(front + '/account/session', { headers: { Cookie: staffCookie } });
        assert.deepEqual(await r.json(), { state: 'signed-out' });
        r = await fetch(front + '/account/login', {
          method: 'POST',
          headers,
          body: JSON.stringify({ email: emails[0], password }),
        });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await r.json(), { status: 'ok' });
        const setCookie = r.headers.get('set-cookie') ?? '';
        assert.ok(setCookie.startsWith(customerCookieName(front) + '='));
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Strict/i);
        assert.ok(setCookie.includes('Path=/'));
        assert.doesNotMatch(setCookie, /commerce_session=/);
        const cookie = setCookie.split(';')[0]!;
        r = await fetch(front + '/account/session', {
          headers: { Cookie: cookie + '; ' + staffCookie, Authorization: 'Bearer ' + staffToken },
        });
        assert.equal(r.status, 200);
        const view = await r.json();
        assert.deepEqual(view.account, { displayName: 'Customer 0', email: emails[0] });
        assert.equal(view.state, 'signed-in');
        assert.doesNotMatch(JSON.stringify(view), /csrf|token|password|grants|accountId/i);
        assert.ok(observed.length >= 3);
        assert.ok(observed.every((x) => !x.cookie && !x.authorization));
        assert.equal(
          (
            await fetch(front + '/account/logout', {
              method: 'POST',
              headers: { ...headers, Origin: 'http://foreign.test', Cookie: cookie },
              body: '{}',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(front + '/account/login', {
              method: 'POST',
              headers: { ...headers, 'X-Requested-With': '' },
              body: '{}',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(front + '/account/login', {
              method: 'POST',
              headers,
              body: 'x'.repeat(9000),
            })
          ).status,
          413,
        );
        assert.equal(
          (await fetch(front + '/account/login', { method: 'POST', headers, body: 'bad json' }))
            .status,
          400,
        );
        assert.equal((await fetch(front + '/account/session?accountId=' + ids[1])).status, 400);
        assert.equal(
          (await (await fetch(front + '/account/session', { headers: { Cookie: cookie } })).json())
            .state,
          'signed-in',
        );
        const html = await (await fetch(front + '/account')).text();
        assert.ok(html.includes('MY ACCOUNT'));
        assert.ok(!html.includes(emails[0]!));
        r = await fetch(front + '/account/logout', {
          method: 'POST',
          headers: { ...headers, Cookie: cookie },
          body: '{}',
        });
        assert.equal(r.status, 200);
        assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=0/);
        assert.equal(
          (await (await fetch(front + '/account/session', { headers: { Cookie: cookie } })).json())
            .state,
          'signed-out',
        );
        assert.equal(
          (await fetch(api + '/api/v1/staff/me', { headers: { Cookie: staffCookie } })).status,
          200,
        );
      },
    );
    await t.test(
      'compiled customer identity migration is repeatable and refuses to discard account history',
      async () => {
        assert.equal((await db.runMigrations()).length, 0);
        const q = db.createQueryRunner(),
          schema = 'customer_probe_' + randomBytes(5).toString('hex');
        try {
          await q.startTransaction();
          await q.query('CREATE SCHEMA ' + schema);
          await q.query('SET LOCAL search_path TO ' + schema + ',pg_catalog');
          await new IdentityFoundation1794096000000().up(q);
          await q.query('UPDATE app_schema_version SET version=26');
          const m = new StoreAccounts1794125000000();
          await m.up(q);
          assert.equal((await q.query('SELECT version FROM app_schema_version'))[0].version, 27);
          await m.down(q);
          assert.equal((await q.query('SELECT version FROM app_schema_version'))[0].version, 26);
          await m.up(q);
          await q.query(
            "INSERT INTO store_customer_accounts(email,display_name,password_hash)VALUES('sample@example.invalid','Sample','unused')",
          );
          await assert.rejects(m.down(q), /Cannot discard/);
        } finally {
          if (q.isTransactionActive) await q.rollbackTransaction();
          await q.release();
        }
      },
    );
  } finally {
    await closed?.close();
    await app?.close();
    await runtime.destroy();
    await db.transaction(async (m) => {
      await m.query(
        'DELETE FROM store_customer_events WHERE account_id=ANY($1::uuid[]) OR request_id=ANY($2::uuid[])',
        [ids, [...requestIds]],
      );
      await m.query('DELETE FROM store_customer_sessions WHERE account_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM store_customer_accounts WHERE id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM store_customer_login_limits WHERE bucket_hash=ANY($1::text[])', [
        [...emailBuckets, ...sourceBuckets],
      ]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=$1', [staff]);
      await m.query('DELETE FROM staff_users WHERE id=$1', [staff]);
    });
    await db.destroy();
  }
});
