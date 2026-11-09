import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveRead } from '../apps/admin/src/data/live-read.js';
import type { ReadEnvironment, ReadOptions } from '../apps/admin/src/data/live-read.js';
function fixture() {
  const clock = { time: 10000, visible: true, online: true, paused: false, timers: 0, wakes: 0 };
  let tick = () => {},
    wake = () => {};
  const deferred = new Set<() => void>();
  const env: ReadEnvironment = {
    after: (fn) => {
      deferred.add(fn);
      return () => {
        deferred.delete(fn);
      };
    },
    now: () => clock.time,
    visible: () => clock.visible,
    online: () => clock.online,
    paused: () => clock.paused,
    every: (fn, ms) => {
      assert.equal(ms, 30000);
      clock.timers++;
      tick = fn;
      return () => {
        clock.timers--;
      };
    },
    onWake: (fn) => {
      clock.wakes++;
      wake = fn;
      return () => {
        clock.wakes--;
      };
    },
  };
  const calls: {
    options: ReadOptions;
    resolve: (value: string[]) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const load = (options: ReadOptions) =>
    new Promise<string[]>((resolve, reject) => {
      calls.push({ options, resolve, reject });
    });
  const resource = new LiveRead(load, env);
  const advance = (ms = 30000) => {
    clock.time += ms;
    tick();
  };
  return {
    clock,
    resource,
    calls,
    advance,
    wake: () => wake(),
    env,
    load,
    flush: () => {
      for (const fn of [...deferred]) {
        deferred.delete(fn);
        fn();
      }
    },
  };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
test('live lists load immediately, poll quietly and keep rows while updating', async () => {
  const f = fixture();
  f.resource.start();
  f.resource.start();
  assert.equal(f.clock.timers, 1);
  assert.equal(f.calls[0]!.options.background, false);
  f.calls[0]!.resolve(['first']);
  await settle();
  const checked = f.resource.snapshot().checkedAt;
  f.advance();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.options.background, true);
  assert.deepEqual(f.resource.snapshot().data, ['first']);
  assert.equal(f.resource.snapshot().refreshing, true);
  f.advance();
  f.wake();
  assert.equal(f.calls.length, 2);
  f.calls[1]!.resolve(['second']);
  await settle();
  assert.deepEqual(f.resource.snapshot().data, ['second']);
  assert.ok(f.resource.snapshot().checkedAt! > checked!);
  f.resource.stop();
  assert.equal(f.clock.timers, 0);
  assert.equal(f.clock.wakes, 0);
});
test('hidden, offline and edited views pause; reconnect is a background read even without cached data', async () => {
  const f = fixture();
  f.clock.online = false;
  f.resource.start();
  assert.equal(f.calls.length, 0);
  f.clock.online = true;
  f.clock.visible = false;
  f.advance();
  assert.equal(f.calls.length, 0);
  f.clock.visible = true;
  f.clock.paused = true;
  f.advance();
  assert.equal(f.calls.length, 0);
  assert.equal(f.resource.snapshot().paused, true);
  f.clock.paused = false;
  f.wake();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.options.background, true);
  f.calls[0]!.resolve(['connected']);
  await settle();
  f.wake();
  assert.equal(f.calls.length, 1);
  f.clock.online = false;
  f.advance();
  assert.equal(f.resource.snapshot().online, false);
  assert.deepEqual(f.resource.snapshot().data, ['connected']);
  f.resource.stop();
});
test('manual retry supersedes an older response and stop prevents late publication', async () => {
  const f = fixture();
  f.resource.start();
  f.resource.refresh();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0]!.options.signal!.aborted, true);
  f.calls[1]!.resolve(['new']);
  await settle();
  f.calls[0]!.resolve(['old']);
  await settle();
  assert.deepEqual(f.resource.snapshot().data, ['new']);
  f.advance();
  f.resource.stop();
  assert.equal(f.calls[2]!.options.signal!.aborted, true);
  f.calls[2]!.resolve(['after unmount']);
  await settle();
  assert.deepEqual(f.resource.snapshot().data, ['new']);
  f.resource.start();
  f.calls[3]!.resolve(['remounted']);
  await settle();
  assert.deepEqual(f.resource.snapshot().data, ['remounted']);
  f.resource.stop();
});
test('transient failures retain last successful data and timestamp, then recover', async () => {
  const f = fixture();
  f.resource.start();
  f.calls[0]!.reject(Error('Unavailable'));
  await settle();
  assert.equal(f.resource.snapshot().error, 'Unavailable');
  assert.equal(f.resource.snapshot().data, null);
  f.resource.refresh();
  f.calls[1]!.resolve(['saved']);
  await settle();
  const time = f.resource.snapshot().checkedAt;
  f.advance();
  f.calls[2]!.reject(Error('Connection lost'));
  await settle();
  assert.deepEqual(f.resource.snapshot().data, ['saved']);
  assert.equal(f.resource.snapshot().checkedAt, time);
  assert.equal(f.resource.snapshot().refreshError, 'Connection lost');
  assert.equal(f.resource.snapshot().error, '');
  f.advance();
  f.calls[3]!.resolve(['recovered']);
  await settle();
  assert.equal(f.resource.snapshot().refreshError, '');
  f.resource.stop();
});
for (const status of [401, 403])
  test(`access denial ${status} clears private rows and stops automatic retries`, async () => {
    const f = fixture();
    f.resource.start();
    f.calls[0]!.resolve(['private']);
    await settle();
    f.advance();
    f.calls[1]!.reject(Object.assign(Error('Access changed'), { status }));
    await settle();
    assert.equal(f.resource.snapshot().data, null);
    assert.equal(f.resource.snapshot().checkedAt, null);
    assert.equal(f.resource.snapshot().accessDenied, true);
    f.advance();
    f.wake();
    assert.equal(f.calls.length, 2);
    f.resource.refresh();
    f.calls[2]!.resolve(['permitted']);
    await settle();
    assert.equal(f.resource.snapshot().accessDenied, false);
    f.resource.stop();
  });
test('a new query starts with no rows from an earlier resource; disabled reads do not request', async () => {
  const f = fixture();
  f.resource.start();
  f.calls[0]!.resolve(['previous query']);
  await settle();
  const next = new LiveRead(f.load, f.env);
  assert.equal(next.snapshot().data, null);
  const disabled = new LiveRead(f.load, f.env, false);
  disabled.start();
  disabled.refresh();
  disabled.wake();
  assert.equal(f.calls.length, 1);
  assert.equal(disabled.snapshot().loading, false);
  disabled.stop();
  f.resource.stop();
});

test('push invalidations coalesce and are not lost behind an in-flight request', async () => {
  const f = fixture();
  f.resource.start();
  f.resource.invalidate();
  f.resource.invalidate();
  f.flush();
  assert.equal(f.calls.length, 1);
  f.calls[0]!.resolve(['old']);
  await settle();
  f.flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.options.background, true);
  f.calls[1]!.resolve(['new']);
  await settle();
  assert.deepEqual(f.resource.snapshot().data, ['new']);
  f.resource.stop();
});
test('push changes wait for an edited, hidden or offline view and resume after it is safe', async () => {
  const f = fixture();
  f.resource.start();
  f.calls[0]!.resolve(['first']);
  await settle();
  f.clock.paused = true;
  f.resource.invalidate();
  f.flush();
  assert.equal(f.calls.length, 1);
  f.clock.paused = false;
  f.clock.visible = false;
  f.wake();
  f.flush();
  assert.equal(f.calls.length, 1);
  f.clock.visible = true;
  f.clock.online = false;
  f.wake();
  f.flush();
  assert.equal(f.calls.length, 1);
  f.clock.online = true;
  f.wake();
  f.flush();
  assert.equal(f.calls.length, 2);
  f.calls[1]!.resolve(['resumed']);
  await settle();
  f.resource.invalidate();
  f.resource.stop();
  f.flush();
  assert.equal(f.calls.length, 2);
});
