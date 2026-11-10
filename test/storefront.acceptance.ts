import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
export interface PublicRequest {
  path: string;
  cookie: boolean;
  authorization: boolean;
}
export async function verifyStorefront(c: {
  t: TestContext;
  api: string;
  slug: string;
  name: string;
  videoUrl: string;
  playback: Buffer;
  privateHashes: string[];
  requests: PublicRequest[];
}) {
  const server = createServer();
  await new Promise<void>((ok, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', ok);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((ok, no) => server.close((e) => (e ? no(e) : ok())));
  const root = resolve('apps/storefront'),
    require = createRequire(join(root, 'package.json')),
    { publicStoreEnvironment } = await import(
      pathToFileURL(resolve('src/scripts/storefront-process.mjs')).href
    ),
    origin = 'http://127.0.0.1:' + port,
    child = spawn(
      process.execPath,
      [
        require.resolve('next/dist/bin/next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...publicStoreEnvironment(process.env, {
            STORE_API_ORIGIN: c.api,
            STORE_SITE_ORIGIN: origin,
            STORE_BRAND_NAME: 'Fixture label',
          }),
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  let diagnostic = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => {
      diagnostic = (diagnostic + String(b)).slice(-12000);
    });
  c.t.after(async () => {
    if (child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 10000);
        deadline.unref();
        child.once('exit', () => {
          clearTimeout(deadline);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
  });
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error('Isolated storefront failed to start: ' + diagnostic);
    try {
      const r = await fetch(origin + '/robots.txt');
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await wait(100);
  }
  assert.ok(ready, 'Isolated storefront must start');
  await c.t.test(
    'Next storefront server-renders published products, metadata and variant controls',
    async () => {
      const home = await fetch(origin + '/');
      assert.equal(home.status, 200);
      assert.ok((await home.text()).includes('Fixture label'));
      const page = await fetch(origin + '/products/' + c.slug);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.ok(html.includes(c.name));
      assert.ok(html.includes('application/ld+json'));
      assert.ok(html.includes('noindex'));
      assert.ok(html.includes('Online ordering is not open yet'));
      for (const value of c.privateHashes)
        assert.ok(!html.includes(value), 'Private media hashes stay server-side');
      for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL'])
        if (process.env[key])
          assert.ok(
            !html.includes(process.env[key]!),
            'Database credentials stay outside the storefront',
          );
    },
  );
  await c.t.test(
    'Next storefront price and option filters use the same actual public SKU',
    async () => {
      const r = await fetch(
        origin + '/shop?size=m&color=red&minPrice=1290&maxPrice=1290&sort=price_asc',
      );
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.ok(html.includes(c.name));
      assert.ok(html.includes('1,290.00'));
      const empty = await fetch(origin + '/shop?q=NO-SUCH-PRODUCT-FOUNDATION');
      assert.ok((await empty.text()).includes('No pieces match'));
      const invalid = await fetch(origin + '/shop?size=M&size=L');
      assert.ok((await invalid.text()).includes('Use one value'));
    },
  );
  await c.t.test(
    'Next media proxy preserves video ranges and drops cookies and authorization',
    async () => {
      const from = c.requests.length,
        path = c.videoUrl.replace('/api/v1/store', '/media'),
        r = await fetch(origin + path, {
          headers: {
            Range: 'bytes=0-31',
            Cookie: 'commerce_session=must-not-forward',
            Authorization: 'Bearer must-not-forward',
          },
        });
      assert.equal(r.status, 206);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), c.playback.subarray(0, 32));
      const rows = c.requests.slice(from);
      assert.ok(rows.some((x) => x.path.includes('/media/')));
      assert.ok(rows.every((x) => !x.cookie && !x.authorization));
    },
  );
  await c.t.test(
    'Next storefront cannot proxy staff APIs, originals or arbitrary remote media',
    async () => {
      const from = c.requests.length;
      for (const path of [
        '/api/v1/catalog/products',
        '/media/catalog/products',
        '/media/photos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/original',
        '/media/photos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/image?url=http://remote.example',
      ]) {
        const r = await fetch(origin + path);
        assert.equal(r.status, 404, path);
      }
      assert.ok(c.requests.slice(from).every((x) => x.path.startsWith('/api/v1/store/')));
    },
  );
  return {
    async verifyWithdrawn() {
      const r = await fetch(origin + '/products/' + c.slug);
      assert.equal(r.status, 404);
      assert.ok((await r.text()).includes('currently unavailable'));
      assert.equal(
        (await fetch(origin + c.videoUrl.replace('/api/v1/store', '/media'))).status,
        404,
      );
    },
  };
}
