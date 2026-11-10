import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const storefrontDirectory = fileURLToPath(
  new URL('../../apps/storefront/', import.meta.url),
);
export function publicStoreEnvironment(parent, config = {}) {
  const origin = new URL(config.STORE_API_ORIGIN ?? 'http://127.0.0.1:4000'),
    site = new URL(config.STORE_SITE_ORIGIN ?? 'http://127.0.0.1:3000');
  for (const u of [origin, site])
    if (
      u.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash
    )
      throw Error('Only loopback storefront origins are supported locally');
  const brand = (config.STORE_BRAND_NAME ?? 'Your brand').normalize('NFC').trim();
  if (!brand || brand.length > 80 || /[\u0000-\u001f\u007f]/u.test(brand))
    throw Error('Invalid public brand name');
  const safe = Object.fromEntries(
    Object.entries(parent).filter(
      ([k, v]) =>
        v !== undefined &&
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
        ].includes(k),
    ),
  );
  return {
    ...safe,
    NEXT_TELEMETRY_DISABLED: '1',
    STORE_API_ORIGIN: origin.origin,
    STORE_SITE_ORIGIN: site.origin,
    STORE_BRAND_NAME: brand,
  };
}
export async function startStorefront({ dev = false } = {}) {
  let config = {};
  try {
    config = parseEnv(await readFile(path.resolve('.env.storefront'), 'utf8'));
    if (
      Object.keys(config).some(
        (k) => !['STORE_API_ORIGIN', 'STORE_SITE_ORIGIN', 'STORE_BRAND_NAME'].includes(k),
      )
    )
      throw Error('Storefront config must contain public store settings only');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const require = createRequire(path.join(storefrontDirectory, 'package.json')),
    bin = require.resolve('next/dist/bin/next');
  return spawn(
    process.execPath,
    [bin, dev ? 'dev' : 'start', '--hostname', '127.0.0.1', '--port', '3000'],
    {
      cwd: storefrontDirectory,
      env: {
        ...publicStoreEnvironment(process.env, config),
        NODE_ENV: dev ? 'development' : 'production',
      },
      windowsHide: true,
      stdio: 'inherit',
    },
  );
}
