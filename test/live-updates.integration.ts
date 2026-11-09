import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createApp } from '../src/app.js';
import { createDataSource, databaseUrl } from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { LiveUpdates1794114000000 } from '../src/database/migrations/1794114000000-live-updates.js';
interface Frame {
  event: string;
  data: Record<string, unknown>;
}
async function stream(base: string, cookie: string) {
  const controller = new AbortController();
  const r = await fetch(base + '/api/v1/staff/events', {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);
  const frames: Frame[] = [],
    waiters = new Set<() => void>();
  const reader = r.body!.getReader();
  const pump = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = chunk.match(/^event: (.+)$/m)?.[1],
            data = chunk.match(/^data: (.+)$/m)?.[1];
          if (event && data) {
            frames.push({ event, data: JSON.parse(data) });
            for (const notify of waiters) notify();
          }
        }
      }
    } catch {
      if (!controller.signal.aborted) throw Error('Test stream unexpectedly failed');
    }
  })();
  const wait = (
    event: string,
    from = 0,
    predicate: (f: Frame) => boolean = () => true,
    ms = 3000,
  ) =>
    new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(Error('Timed out waiting for ' + event));
      }, ms);
      const check = () => {
        const match = frames.slice(from).find((f) => f.event === event && predicate(f));
        if (match) {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(match);
        }
      };
      waiters.add(check);
      check();
    });
  return {
    frames,
    wait,
    close: async () => {
      controller.abort();
      await pump;
    },
  };
}
test('live updates: commit-only cross-instance delivery, privacy and idle security', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const db = createDataSource();
  await db.initialize();
  await db.runMigrations();
  await grantRuntime(db, process.env);
  const ids = [randomUUID(), randomUUID()],
    locations = [randomUUID(), randomUUID()],
    role = randomUUID(),
    category = randomUUID(),
    suffix = randomBytes(5).toString('hex');
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  const cookie = (i: number) => 'commerce_session=' + tokens[i];
  const apps: Awaited<ReturnType<typeof createApp>>[] = [],
    streams: Awaited<ReturnType<typeof stream>>[] = [];
  const notify = new Client({ connectionString: databaseUrl(process.env, 'DATABASE_URL') });
  try {
    await db.transaction(async (m) => {
      for (let i = 0; i < 2; i++) {
        await m.query(
          "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Disposable push test','not-login-hash',false)",
          [ids[i], 'push.test.' + suffix + i],
        );
        await m.query(
          "INSERT INTO staff_sessions(staff_id,token_hash,csrf_token,last_seen_at) VALUES($1,$2,$3,now()-interval '5 minutes')",
          [ids[i], tokenHash(tokens[i]!), randomBytes(32).toString('hex')],
        );
        await m.query(
          "INSERT INTO locations(id,code,name) VALUES($1,$2,'Disposable push location')",
          [locations[i], 'PUSH' + suffix.toUpperCase() + i],
        );
      }
      await m.query(
        "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
        [ids[0]],
      );
      await m.query('INSERT INTO roles(id,code) VALUES($1,$2)', [role, 'push_' + suffix]);
      await m.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'inventory.read')",
        [role],
      );
      await m.query(
        'INSERT INTO staff_role_assignments(staff_id,role_id,location_id) VALUES($1,$2,$3)',
        [ids[1], role, locations[0]],
      );
      await m.query('INSERT INTO catalog_categories(id,name,name_key) VALUES($1,$2,$3)', [
        category,
        'Push ' + suffix,
        'push ' + suffix,
      ]);
    });
    for (let i = 0; i < 2; i++) {
      const app = await createApp({ ...process.env, STAFF_ORIGIN: 'http://staff.test' });
      await app.listen(0, '127.0.0.1');
      apps.push(app);
    }
    const base = await apps[0]!.getUrl(),
      other = await apps[1]!.getUrl();
    await t.test('unauthenticated and cross-site requests fail before a stream opens', async () => {
      assert.equal((await fetch(base + '/api/v1/staff/events')).status, 401);
      assert.equal(
        (
          await fetch(base + '/api/v1/staff/events', {
            headers: { Cookie: cookie(0), Origin: 'http://evil.test' },
          })
        ).status,
        403,
      );
    });
    const before = (
      await db.query('SELECT last_seen_at FROM staff_sessions WHERE token_hash=$1', [
        tokenHash(tokens[0]!),
      ])
    )[0].last_seen_at.getTime();
    const owner = await stream(base, cookie(0)),
      second = await stream(other, cookie(0)),
      scoped = await stream(base, cookie(1));
    streams.push(owner, second, scoped);
    for (const s of streams) await s.wait('ready');
    await notify.connect();
    await t.test(
      'a committed database change reaches both app instances with only topic names',
      async () => {
        const a = owner.frames.length,
          b = second.frames.length;
        await db.query('UPDATE catalog_categories SET name=name WHERE id=$1', [category]);
        for (const [s, from] of [
          [owner, a],
          [second, b],
        ] as const) {
          const frame = await s.wait('invalidate', from, (f) =>
            (f.data.topics as string[]).includes('catalog'),
          );
          assert.deepEqual(frame.data, { topics: ['catalog'] });
        }
        assert.equal(
          (
            await db.query('SELECT last_seen_at FROM staff_sessions WHERE token_hash=$1', [
              tokenHash(tokens[0]!),
            ])
          )[0].last_seen_at.getTime(),
          before,
        );
      },
    );
    await t.test('rollback never produces a change hint', async () => {
      const client = new Client({ connectionString: databaseUrl(process.env, 'DATABASE_URL') });
      await client.connect();
      await client.query('LISTEN commerce_staff_changes');
      let notifications = 0;
      client.on('notification', () => notifications++);
      try {
        await assert.rejects(
          db.transaction(async (m) => {
            await m.query('UPDATE catalog_categories SET name=name WHERE id=$1', [category]);
            throw Error('rollback fixture');
          }),
          /rollback fixture/,
        );
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(notifications, 0);
      } finally {
        await client.end();
      }
    });
    await t.test(
      'location scope filters hints and strips location IDs from permitted frames',
      async () => {
        const from = scoped.frames.length;
        await notify.query("SELECT pg_notify('commerce_staff_changes',$1)", [
          JSON.stringify({ topic: 'inventory', locationId: locations[1] }),
        ]);
        await new Promise((r) => setTimeout(r, 250));
        assert.equal(
          scoped.frames.slice(from).some((f) => f.event === 'invalidate'),
          false,
        );
        await notify.query("SELECT pg_notify('commerce_staff_changes',$1)", [
          JSON.stringify({ topic: 'inventory', locationId: locations[0] }),
        ]);
        assert.deepEqual((await scoped.wait('invalidate', from)).data, { topics: ['inventory'] });
      },
    );
    await t.test(
      'a dropped database listener reconnects and requests a full reconciliation',
      async () => {
        const offsets = streams.map((s) => s.frames.length);
        const result = await notify.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='commerce_staff_notifications' AND usename=current_user",
        );
        assert.equal(result.rowCount, 2);
        for (let i = 0; i < streams.length; i++) {
          await streams[i]!.wait('degraded', offsets[i]!);
          await streams[i]!.wait('ready', offsets[i]!, () => true, 6000);
          await streams[i]!.wait(
            'invalidate',
            offsets[i]!,
            (f) => (f.data.topics as string[]).includes('all'),
            6000,
          );
        }
      },
    );
    await t.test('permission removal affects the next hint without reconnecting', async () => {
      const from = scoped.frames.length;
      await db.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [ids[1]]);
      await scoped.wait('invalidate', from, (f) => (f.data.topics as string[]).includes('all'));
      const after = scoped.frames.length;
      await notify.query("SELECT pg_notify('commerce_staff_changes',$1)", [
        JSON.stringify({ topic: 'inventory', locationId: locations[0] }),
      ]);
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(
        scoped.frames.slice(after).some((f) => f.event === 'invalidate'),
        false,
      );
    });
    await t.test('idle expiry closes an already open stream without keeping it alive', async () => {
      const from = owner.frames.length;
      await db.query(
        "UPDATE staff_sessions SET last_seen_at=now()-interval '31 minutes' WHERE token_hash=$1",
        [tokenHash(tokens[0]!)],
      );
      await db.query('UPDATE catalog_categories SET name=name WHERE id=$1', [category]);
      await owner.wait('session-ended', from);
      assert.equal(
        (await fetch(base + '/api/v1/staff/events', { headers: { Cookie: cookie(0) } })).status,
        401,
      );
    });
    await t.test(
      'compiled notification migration reverts and reapplies without altering business rows',
      async () => {
        const r = db.createQueryRunner();
        await r.connect();
        const migration = new LiveUpdates1794114000000();
        try {
          await r.startTransaction();
          const before = await r.query(
            'SELECT to_jsonb(c) AS row FROM catalog_categories c WHERE id=$1',
            [category],
          );
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 15);
          await migration.up(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 16);
          assert.deepEqual(
            await r.query('SELECT to_jsonb(c) AS row FROM catalog_categories c WHERE id=$1', [
              category,
            ]),
            before,
          );
          await r.rollbackTransaction();
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
      },
    );
  } finally {
    for (const s of streams) await s.close();
    for (const app of apps) await app.close();
    await notify.end().catch(() => undefined);
    await db.transaction(async (m) => {
      await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM role_permissions WHERE role_id=$1', [role]);
      await m.query('DELETE FROM roles WHERE id=$1', [role]);
      await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [ids]);
      await m.query('DELETE FROM locations WHERE id=ANY($1::uuid[])', [locations]);
      await m.query('DELETE FROM catalog_categories WHERE id=$1', [category]);
    });
    await db.destroy();
  }
});
