import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import {
  createDataSource,
  createRuntimeDataSource,
  databaseUrl,
} from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { IdentityFoundation1794096000000 } from '../src/database/migrations/1794096000000-identity-foundation.js';
import { CatalogFoundation1794100000000 } from '../src/database/migrations/1794100000000-catalog-foundation.js';
import { ProductMedia1794101000000 } from '../src/database/migrations/1794101000000-product-media.js';
import type { MediaResult } from '../src/modules/catalog/media.types.js';
test('product media: protected real HTTP upload, storage and transactional history', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const root = await mkdtemp(join(tmpdir(), 'commerce-media-test-')),
    source = createDataSource();
  const users = [randomUUID(), randomUUID(), randomUUID()],
    role = randomUUID(),
    prefix = 'media_' + randomBytes(5).toString('hex'),
    origin = 'http://media.test';
  const password = 'Disposable media integration password 2026!',
    style = prefix.toUpperCase(),
    requests: string[] = [];
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '',
    productId = '',
    version = 1,
    schemaReady = false;
  type Session = { cookie: string; csrf: string };
  const sessions: Session[] = [];
  const auth = (s: Session) => ({
    Origin: origin,
    'X-Requested-With': 'commerce-staff',
    'X-CSRF-Token': s.csrf,
    Cookie: s.cookie,
  });
  const record = (r: Response) => {
    const id = r.headers.get('x-request-id');
    if (id) requests.push(id);
    return r;
  };
  async function json(path: string, s: Session, body?: unknown, key?: string) {
    return record(
      await fetch(base + '/api/v1/catalog' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...auth(s),
          'Content-Type': 'application/json',
          ...(key ? { 'X-Idempotency-Key': key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  }
  async function upload(
    body: Buffer,
    v: number,
    key = randomUUID(),
    s = sessions[0]!,
    extra: Record<string, string> = {},
  ) {
    return record(
      await fetch(base + '/api/v1/catalog/products/' + productId + '/photos', {
        method: 'POST',
        headers: {
          ...auth(s),
          'Content-Type': 'image/png',
          'X-Product-Version': String(v),
          'X-Idempotency-Key': key,
          ...extra,
        },
        body: new Uint8Array(body),
      }),
    );
  }
  let photoId = '',
    firstUrl = '',
    state: MediaResult;
  await source.initialize();
  try {
    await source.runMigrations();
    await grantRuntime(source, process.env);
    schemaReady = true;
    await source.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
      ['ip:127.0.0.1', 'ip:::ffff:127.0.0.1', ...users.map((_, i) => 'user:' + prefix + i)].map(
        tokenHash,
      ),
    ]);
    const hash = await new PasswordService().hash(password);
    await source.transaction(async (m) => {
      for (const [i, id] of users.entries())
        await m.query(
          'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES ($1,$2,$3,$4,false)',
          [id, prefix + i, 'Media fixture', hash],
        );
      for (const id of [users[0], users[2]])
        await m.query(
          "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
          [id],
        );
      await m.query('INSERT INTO roles(id,code) VALUES ($1,$2)', [role, prefix]);
      await m.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES ($1,'catalog.read')",
        [role],
      );
      await m.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES ($1,$2)', [
        users[1],
        role,
      ]);
    });
    app = await createApp({ ...process.env, MEDIA_STORAGE_DIR: root, STAFF_ORIGIN: origin });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    for (let i = 0; i < 3; i++) {
      const response = record(
        await fetch(base + '/api/v1/auth/login', {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Requested-With': 'commerce-staff',
          },
          body: JSON.stringify({ username: prefix + i, password }),
        }),
      );
      assert.equal(response.status, 200);
      const b = await response.json();
      sessions.push({
        cookie: response.headers.get('set-cookie')!.split(';')[0]!,
        csrf: b.csrfToken,
      });
    }
    const created = await json(
      '/products',
      sessions[0]!,
      {
        styleCode: style,
        name: 'Media fixture product',
        status: 'active',
        currency: 'BDT',
        variants: [
          {
            sku: style + '-M',
            attributes: { size: 'M' },
            barcode: null,
            price: '100.10',
            isActive: true,
          },
        ],
      },
      randomUUID(),
    );
    assert.equal(created.status, 201);
    const product = await created.json();
    productId = product.id;
    assert.deepEqual(product.photos, []);
    const png = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#d36b24' },
    })
      .png()
      .withExif({ IFD0: { Artist: 'Private fixture metadata' } })
      .toBuffer();
    await t.test(
      'upload rejects missing permission/CSRF, spoofed data and oversize before storage',
      async () => {
        assert.equal((await upload(png, version, randomUUID(), sessions[1]!)).status, 403);
        assert.equal(
          (await upload(png, version, randomUUID(), sessions[0]!, { 'X-CSRF-Token': 'wrong' }))
            .status,
          403,
        );
        assert.equal((await upload(Buffer.from('<svg/>'), version)).status, 422);
        const status = await new Promise<number>((resolve, reject) => {
          const request = httpRequest(
            base + '/api/v1/catalog/products/' + productId + '/photos',
            {
              method: 'POST',
              headers: {
                ...auth(sessions[0]!),
                'Content-Type': 'image/png',
                'Content-Length': String(5 * 1024 * 1024 + 1),
                'X-Product-Version': String(version),
                'X-Idempotency-Key': randomUUID(),
              },
            },
            (response) => {
              response.resume();
              resolve(response.statusCode!);
            },
          );
          request.on('error', reject);
          request.setTimeout(5000, () => request.destroy(new Error('Oversize response timed out')));
          request.flushHeaders();
        });
        assert.equal(status, 413);
        assert.deepEqual(await readdir(root), []);
      },
    );
    await t.test(
      'concurrent retries publish exactly one safe photo and return protected thumbnails',
      async () => {
        const key = randomUUID(),
          responses = await Promise.all([upload(png, version, key), upload(png, version, key)]);
        assert.deepEqual(
          responses.map((r) => r.status),
          [201, 201],
        );
        state = await responses[0]!.json();
        assert.deepEqual(await responses[1]!.json(), state);
        version = state.version;
        assert.equal(version, 2);
        assert.equal(state.photos.length, 1);
        assert.equal(state.photos[0]!.isPrimary, true);
        photoId = state.photos[0]!.id;
        firstUrl = state.photos[0]!.url;
        assert.equal(
          (
            await source.query(
              "SELECT count(*)::int AS count FROM audit_events WHERE actor_id=$1 AND action='catalog.photo_uploaded'",
              [users[0]],
            )
          )[0].count,
          1,
        );
        assert.equal((await readdir(root)).length, 2);
        assert.equal((await fetch(base + firstUrl)).status, 401);
        const full = await fetch(base + firstUrl, { headers: auth(sessions[1]!) });
        assert.equal(full.status, 200);
        assert.equal(full.headers.get('content-type'), 'image/webp');
        assert.equal(full.headers.get('cache-control'), 'no-store');
        const decoded = await sharp(Buffer.from(await full.arrayBuffer())).metadata();
        assert.equal(decoded.width, 1600);
        assert.equal(decoded.exif, undefined);
        const thumb = await fetch(base + state.photos[0]!.thumbnailUrl, {
          headers: auth(sessions[0]!),
        });
        assert.equal(thumb.status, 200);
        assert.ok((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width! <= 480);
        const listing = await (await json('/products?search=' + style, sessions[0]!)).json();
        assert.equal(listing.items[0].primaryPhoto.thumbnailUrl, state.photos[0]!.thumbnailUrl);
        assert.equal((await upload(png, 1, key, sessions[2]!)).status, 409);
        assert.equal((await upload(Buffer.from('different'), 1, key)).status, 409);
      },
    );
    await t.test(
      'stale photo changes roll back files and metadata; primary/removal preserve history',
      async () => {
        assert.equal((await upload(png, 1)).status, 409);
        assert.equal((await readdir(root)).length, 2);
        const second = await upload(png, version);
        assert.equal(second.status, 201);
        state = await second.json();
        version = state.version;
        const secondId = state.photos.find((p) => p.id !== photoId)!.id;
        const key = randomUUID(),
          path = '/products/' + productId + '/photos/' + secondId + '/primary';
        const primary = await json(path, sessions[0]!, { expectedVersion: version }, key);
        assert.equal(primary.status, 200);
        const oldVersion = version;
        state = await primary.json();
        version = state.version;
        assert.deepEqual(
          await (await json(path, sessions[0]!, { expectedVersion: oldVersion }, key)).json(),
          state,
        );
        assert.equal(state.photos.find((p) => p.isPrimary)!.id, secondId);
        const removed = await json(
          '/products/' + productId + '/photos/' + secondId + '/remove',
          sessions[0]!,
          { expectedVersion: version },
          randomUUID(),
        );
        assert.equal(removed.status, 200);
        state = await removed.json();
        version = state.version;
        assert.equal(state.photos.length, 1);
        assert.equal(state.photos[0]!.id, photoId);
        assert.equal(state.photos[0]!.isPrimary, true);
        assert.equal(
          (
            await fetch(base + '/api/v1/catalog/photos/' + secondId + '/image', {
              headers: auth(sessions[0]!),
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await source.query('SELECT is_active FROM catalog_product_photos WHERE id=$1', [
              secondId,
            ])
          )[0].is_active,
          false,
        );
        assert.equal((await readdir(root)).length, 4);
      },
    );
    await t.test(
      'simultaneous media edits reject a stale revision instead of overwriting',
      async () => {
        const responses = await Promise.all([upload(png, version), upload(png, version)]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        state = await responses.find((r) => r.status === 201)!.json();
        version = state.version;
        assert.equal(state.photos.length, 2);
      },
    );
    await t.test(
      'failed audit rolls back upload, version and save key and discards unpublished objects',
      async () => {
        const trigger = 'media_audit_' + randomBytes(4).toString('hex'),
          key = randomUUID(),
          before = (await readdir(root)).length;
        await source.query(
          'CREATE FUNCTION "' +
            trigger +
            "\"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='catalog.photo_uploaded' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$",
        );
        await source.query(
          'CREATE TRIGGER "' +
            trigger +
            '" BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION "' +
            trigger +
            '"()',
        );
        try {
          assert.equal((await upload(png, version, key)).status, 500);
          assert.equal((await readdir(root)).length, before);
          assert.equal(
            (
              await source.query(
                'SELECT count(*)::int AS count FROM catalog_media_requests WHERE key=$1',
                [key],
              )
            )[0].count,
            0,
          );
          assert.equal(
            (await source.query('SELECT version FROM catalog_products WHERE id=$1', [productId]))[0]
              .version,
            version,
          );
        } finally {
          await source.query('DROP TRIGGER "' + trigger + '" ON audit_events');
          await source.query('DROP FUNCTION "' + trigger + '"()');
        }
        const retry = await upload(png, version, key);
        assert.equal(retry.status, 201);
        state = await retry.json();
        version = state.version;
      },
    );
    await t.test('photo limit and restricted runtime grants protect retained objects', async () => {
      while (state.photos.length < 8) {
        const response = await upload(png, version);
        assert.equal(response.status, 201);
        state = await response.json();
        version = state.version;
      }
      const before = (await readdir(root)).length;
      assert.equal((await upload(png, version)).status, 409);
      assert.equal((await readdir(root)).length, before);
      const runtime = createRuntimeDataSource();
      await runtime.initialize();
      try {
        await assert.rejects(
          runtime.query('DELETE FROM catalog_product_photos WHERE id=$1', [photoId]),
          { code: '42501' },
        );
        await assert.rejects(
          runtime.query('UPDATE catalog_product_photos SET content_hash=$1 WHERE id=$2', [
            '0'.repeat(64),
            photoId,
          ]),
          { code: '42501' },
        );
      } finally {
        await runtime.destroy();
      }
    });
    await t.test(
      'media migration applies and reverts independently in a scratch schema',
      async () => {
        const runner = source.createQueryRunner(),
          schema = 'media_probe_' + randomBytes(4).toString('hex');
        try {
          await runner.startTransaction();
          await runner.query('CREATE SCHEMA "' + schema + '"');
          await runner.query('SET LOCAL search_path TO "' + schema + '",pg_catalog');
          await new IdentityFoundation1794096000000().up(runner);
          await new CatalogFoundation1794100000000().up(runner);
          const migration = new ProductMedia1794101000000();
          await migration.up(runner);
          assert.equal(
            (await runner.query('SELECT version FROM app_schema_version'))[0].version,
            3,
          );
          await migration.down(runner);
          assert.equal(
            (await runner.query('SELECT version FROM app_schema_version'))[0].version,
            2,
          );
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );
  } finally {
    if (app) await app.close();
    try {
      if (schemaReady)
        await source.transaction(async (m) => {
          await m.query('DELETE FROM catalog_media_requests WHERE product_id=$1', [
            productId || randomUUID(),
          ]);
          await m.query('DELETE FROM catalog_product_photos WHERE product_id=$1', [
            productId || randomUUID(),
          ]);
          await m.query('DELETE FROM catalog_requests WHERE resource_id=$1', [
            productId || randomUUID(),
          ]);
          await m.query('DELETE FROM catalog_variants WHERE product_id=$1', [
            productId || randomUUID(),
          ]);
          await m.query('DELETE FROM catalog_products WHERE id=$1', [productId || randomUUID()]);
          await m.query(
            'DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[]) OR request_id=ANY($2::uuid[])',
            [users, requests],
          );
          await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [
            users,
          ]);
          await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
          await m.query('DELETE FROM role_permissions WHERE role_id=$1', [role]);
          await m.query('DELETE FROM roles WHERE id=$1', [role]);
          await m.query('DELETE FROM login_rate_limits WHERE bucket_hash=ANY($1::text[])', [
            [
              'ip:127.0.0.1',
              'ip:::ffff:127.0.0.1',
              ...users.map((_, i) => 'user:' + prefix + i),
            ].map(tokenHash),
          ]);
        });
    } finally {
      await source.destroy();
      if (
        !resolve(root).startsWith(resolve(tmpdir()) + sep) ||
        !basename(root).startsWith('commerce-media-test-')
      )
        throw Error('Unsafe test cleanup');
      await rm(root, { recursive: true, force: true });
    }
  }
});
