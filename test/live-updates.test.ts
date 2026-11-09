import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseHint, permittedTopics } from '../src/modules/live-updates/change-hint.js';
import { LiveConnection } from '../apps/admin/src/data/live-connection.js';
import type { PushStream } from '../apps/admin/src/data/live-connection.js';
import { LiveUpdatesService } from '../src/modules/live-updates/live-updates.service.js';
import type { Principal } from '../src/modules/identity/http.types.js';
test('push hints are allowlisted and inventory signals respect location grants', () => {
  const a = randomUUID(),
    b = randomUUID();
  for (const raw of ['broken', 'null', '{}', '{"topic":"private_table"}', '{"topic":"inventory"}'])
    assert.equal(parseHint(raw), null);
  assert.deepEqual(parseHint('{"topic":"catalog","secret":"ignored"}'), { topic: 'catalog' });
  const hints = [{ topic: 'inventory' as const, locationId: b }, { topic: 'catalog' as const }];
  assert.deepEqual(permittedTopics(hints, [{ code: 'inventory.read', locationId: a }]), []);
  assert.deepEqual(permittedTopics(hints, [{ code: 'inventory.read', locationId: b }]), [
    'inventory',
  ]);
  assert.deepEqual(
    permittedTopics(
      [{ topic: 'reservations', locationId: a }],
      [{ code: 'inventory.read', locationId: a }],
    ),
    ['inventory'],
  );
  assert.deepEqual(
    permittedTopics([{ topic: 'purchasing' }], [{ code: 'payables.read', locationId: null }]),
    ['purchasing'],
  );
});
class Stream implements PushStream {
  listeners = new Map<string, ((event: { data?: string }) => void)[]>();
  closed = false;
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: string) {
    for (const fn of this.listeners.get(type) ?? []) fn(data === undefined ? {} : { data });
  }
}
test('one browser stream handles reconnect status, safe hints, expiry and late callbacks', () => {
  const source = new Stream(),
    statuses: boolean[] = [],
    changes: string[][] = [];
  let expired = 0,
    created = 0;
  const connection = new LiveConnection(
    () => {
      created++;
      return source;
    },
    (s) => statuses.push(s),
    (x) => changes.push(x),
    () => expired++,
  );
  connection.start();
  connection.start();
  assert.equal(created, 1);
  source.emit('ready');
  assert.equal(statuses.at(-1), true);
  source.emit('error');
  assert.equal(statuses.at(-1), false);
  source.emit('ready');
  source.emit('invalidate', '{"topics":["catalog","catalog","private"]}');
  assert.deepEqual(changes, [['catalog']]);
  source.emit('invalidate', 'bad');
  source.emit('heartbeat');
  assert.equal(changes.length, 1);
  source.emit('degraded');
  assert.equal(statuses.at(-1), false);
  source.emit('session-ended');
  assert.equal(expired, 1);
  assert.equal(source.closed, true);
  source.emit('ready');
  source.emit('invalidate', '{"topics":["all"]}');
  assert.equal(changes.length, 1);
  assert.equal(statuses.at(-1), false);
});
class Response extends EventEmitter {
  statusCode = 0;
  destroyed = false;
  writableEnded = false;
  chunks: string[] = [];
  slow = false;
  setHeader() {}
  flushHeaders() {}
  write(text: string) {
    this.chunks.push(text);
    return !this.slow;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
}
const principal: Principal = {
  id: randomUUID(),
  username: 'test',
  displayName: 'Test',
  mustChangePassword: false,
  sessionId: randomUUID(),
  csrfToken: 'not-used',
  grants: [],
};
test('stream checks do not renew activity; slow clients close and connection limits release', async () => {
  let checks = 0;
  const service = new LiveUpdatesService(
    {
      authenticate: async (_token, renew) => {
        checks++;
        assert.equal(renew, false);
        return principal;
      },
    },
    null,
  );
  const responses = Array.from({ length: 5 }, () => new Response());
  try {
    for (const r of responses) service.open('fixture', principal, r as unknown as ServerResponse);
    assert.throws(
      () => service.open('fixture', principal, new Response() as unknown as ServerResponse),
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        'getStatus' in e &&
        (e as { getStatus: () => number }).getStatus() === 429,
    );
    await Promise.resolve();
    assert.equal(checks, 5);
    responses[0]!.end();
    const slow = new Response();
    slow.slow = true;
    service.open('fixture', principal, slow as unknown as ServerResponse);
    await Promise.resolve();
    assert.equal(slow.writableEnded, true);
  } finally {
    await service.beforeApplicationShutdown();
  }
  assert.ok(responses.every((r) => r.writableEnded));
});
