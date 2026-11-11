import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { publicStoreEnvironment, storefrontDirectory } from './storefront-process.mjs';
const cfg = parseEnv(await readFile('.env.demo', 'utf8'));
if (
  cfg.DEMO_MODE !== '1' ||
  new URL(cfg.DATABASE_URL).pathname !== '/commerce_platform_demo' ||
  cfg.HOST !== '127.0.0.1' ||
  cfg.PORT !== '4100' ||
  cfg.STAFF_ORIGIN !== 'http://127.0.0.1:4100'
)
  throw Error('Separate loopback demo configuration required');
await readFile('.local-setup/demo-fixtures.json', 'utf8');
const children = [],
  safe = publicStoreEnvironment(process.env),
  require = createRequire(path.join(storefrontDirectory, 'package.json'));
let stopping = false;
const api = spawn(process.execPath, ['--env-file=.env.demo', 'dist/src/main.js'], {
  windowsHide: true,
  stdio: 'inherit',
});
children.push(api);
const worker = spawn(
  process.execPath,
  ['--env-file=.env.video-worker.demo', 'dist/src/scripts/video-worker.js'],
  { env: safe, windowsHide: true, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] },
);
children.push(worker);
const store = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3100'],
  {
    cwd: storefrontDirectory,
    env: {
      ...publicStoreEnvironment(process.env, {
        STORE_API_ORIGIN: 'http://127.0.0.1:4100',
        STORE_SITE_ORIGIN: 'http://127.0.0.1:3100',
        STORE_BRAND_NAME: 'Demo brand',
      }),
      NODE_ENV: 'production',
    },
    windowsHide: true,
    stdio: 'inherit',
  },
);
children.push(store);
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c === worker && worker.connected) worker.send({ type: 'shutdown' }, () => {});
    else c.kill('SIGTERM');
  }
  const timer = setTimeout(() => {
    for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  }, 10000);
  timer.unref();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
for (const c of children) {
  c.once('error', () => {
    console.error('A local demo service could not start. Sample data was retained.');
    process.exitCode = 1;
    stop();
  });
  c.once('exit', (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}
console.log(
  'Persistent local demo: staff http://127.0.0.1:4100/admin ; storefront http://127.0.0.1:3100 . Sample data is retained on stop.',
);
