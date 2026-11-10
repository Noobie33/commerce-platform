import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { publicStoreEnvironment, storefrontDirectory } from './storefront-process.mjs';
const command = process.argv[2];
if (!['build', 'typegen'].includes(command))
  throw Error('Expected a supported storefront build command');
const require = createRequire(path.join(storefrontDirectory, 'package.json')),
  child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), command], {
    cwd: storefrontDirectory,
    env: { ...publicStoreEnvironment(process.env), NODE_ENV: 'production' },
    windowsHide: true,
    stdio: 'inherit',
  });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill('SIGTERM'));
child.once('error', () => {
  console.error('Storefront build command could not start.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
