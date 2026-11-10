import {
  videoWorkerSource,
  assertVideoWorker,
  VideoWorker,
} from '../modules/catalog/video-worker.js';
import { setTimeout as wait } from 'node:timers/promises';
const db = videoWorkerSource(process.env),
  stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
process.on('message', (message: unknown) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown')
    stop.abort();
});
try {
  await db.initialize();
  await assertVideoWorker(db);
  const worker = new VideoWorker(db, process.env);
  if (process.argv.includes('--reconcile')) console.log(JSON.stringify(await worker.reconcile()));
  else {
    console.log('Local restricted video worker ready. No public publication is enabled.');
    do {
      const worked = await worker.once(stop.signal);
      if (process.argv.includes('--once')) break;
      if (!worked && !stop.signal.aborted)
        await wait(1500, undefined, { signal: stop.signal }).catch(() => {});
    } while (!stop.signal.aborted);
  }
} catch {
  console.error(
    'Video worker stopped. Check restricted credentials, schema, private storage and tools; secrets withheld.',
  );
  process.exitCode = 1;
} finally {
  await db.destroy().catch(() => {});
  if (process.connected) process.disconnect();
}
