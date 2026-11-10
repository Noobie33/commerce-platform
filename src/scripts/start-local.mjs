import { startStorefront } from './storefront-process.mjs';
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const config = parseEnv(await readFile('.env', 'utf8'));
let stopping = false,
  worker,
  storefront;
const api = spawn(process.execPath, ['--env-file=.env', 'dist/src/main.js'], {
  stdio: 'inherit',
  windowsHide: true,
});
function stopWorker() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  if (worker.connected) worker.send({ type: 'shutdown' }, () => {});
  else worker.kill('SIGTERM');
  const deadline = setTimeout(() => worker?.kill('SIGKILL'), 10000);
  deadline.unref();
  worker.once('exit', () => clearTimeout(deadline));
}
const stop = () => {
  if (stopping) return;
  stopping = true;
  storefront?.kill('SIGTERM');
  stopWorker();
  api.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
api.once('error', () => {
  console.error('Local API could not start.');
  stop();
  process.exitCode = 1;
});
api.once('exit', (code) => {
  stopping = true;
  storefront?.kill('SIGTERM');
  stopWorker();
  process.exitCode = code ?? 1;
});
if (config.VIDEO_INTAKE_MODE === 'local-development' && config.NODE_ENV !== 'production') {
  try {
    await access('.env.video-worker');
    const safeEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) =>
          value !== undefined &&
          [
            'PATH',
            'Path',
            'SystemRoot',
            'WINDIR',
            'TEMP',
            'TMP',
            'HOME',
            'USERPROFILE',
            'APPDATA',
            'LOCALAPPDATA',
            'LANG',
            'LC_ALL',
          ].includes(key),
      ),
    );
    if (!stopping) {
      worker = spawn(
        process.execPath,
        ['--env-file=.env.video-worker', 'dist/src/scripts/video-worker.js'],
        { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true, env: safeEnv },
      );
      worker.once('error', () =>
        console.error('Video worker could not start; received jobs remain queued.'),
      );
      worker.once('exit', (code) => {
        if (!stopping)
          console.error(
            'Video worker stopped; received jobs remain queued. Restart the local workspace after checking configuration.',
          );
      });
    }
  } catch {
    console.error(
      'Video worker configuration is missing; uploads remain queued until it is configured.',
    );
  }
}

if (!stopping) {
  try {
    await access('apps/storefront/.next/BUILD_ID');
    storefront = await startStorefront();
    if (stopping) storefront.kill('SIGTERM');
    storefront.once('error', () =>
      console.error('Customer storefront could not start; staff workspace remains available.'),
    );
    storefront.once('exit', () => {
      if (!stopping)
        console.error('Customer storefront stopped; staff workspace remains available.');
    });
  } catch {
    console.error(
      'Customer storefront is not built or configured; staff workspace remains available.',
    );
  }
}
