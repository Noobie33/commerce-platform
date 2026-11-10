import { startStorefront } from './storefront-process.mjs';
let child;
try {
  child = await startStorefront({ dev: process.argv.includes('--dev') });
  for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => child?.kill('SIGTERM'));
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  child.once('error', () => {
    console.error('Storefront could not start. Check local configuration and its build.');
    process.exitCode = 1;
  });
} catch {
  console.error('Storefront could not start. Check local configuration and dependencies.');
  process.exitCode = 1;
}
