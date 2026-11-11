import { openStorefrontFixture } from './storefront.acceptance.js';
import type { PublicRequest } from './storefront.acceptance.js';
import { verifyGalleryRelease } from './gallery-release.acceptance.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import {
  createDataSource,
  createRuntimeDataSource,
  databaseUrl,
} from '../src/infrastructure/database/data-source.js';
import { grantRuntime } from '../src/database/runtime-grants.js';
import { tokenHash } from '../src/modules/identity/identity.service.js';
import { LocalMediaStore } from '../src/infrastructure/media/local-media.store.js';
import { ImageProcessor } from '../src/infrastructure/media/image-processor.js';
import { readMediaPolicy } from '../src/infrastructure/media/media-policy.js';
import { CatalogPublication1794117000000 } from '../src/database/migrations/1794117000000-catalog-publication.js';
import type { PublicationView } from '../src/modules/catalog/publication.types.js';

test('publication: private drafts, explicit media consent, safe public releases and immediate withdrawal', async (t) => {
  assert.equal(
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname,
    '/commerce_platform_test',
  );
  const publicRequests: PublicRequest[] = [];
  const videoRoot = await mkdtemp(join(tmpdir(), 'commerce-gallery-release-'));
  const db = createDataSource(),
    runtime = createRuntimeDataSource();
  await db.initialize();
  await db.runMigrations();
  await grantRuntime(db, process.env);
  await runtime.initialize();
  const users = [randomUUID(), randomUUID(), randomUUID()],
    roles = [randomUUID(), randomUUID()],
    tokens = users.map(() => randomBytes(32).toString('base64url')),
    csrf = users.map(() => randomBytes(32).toString('hex')),
    product = randomUUID(),
    guide = randomUUID(),
    category = randomUUID(),
    variant = randomUUID(),
    secondVariant = randomUUID(),
    photo = randomUUID(),
    secondPhoto = randomUUID(),
    sortingProducts = [randomUUID(), randomUUID()],
    sortingPhotos = [randomUUID(), randomUUID()],
    suffix = randomBytes(4).toString('hex'),
    slug = 'release-shirt-' + suffix,
    origin = 'http://publication.test',
    store = new LocalMediaStore(process.env);
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    base = '';
  const h = (who = 0) => ({
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'commerce-staff',
    Cookie: 'commerce_session=' + tokens[who],
    'X-CSRF-Token': csrf[who]!,
  });
  const call = (path: string, body?: unknown, who = 0, key = randomUUID()) =>
    fetch(base + '/api/v1/catalog/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...h(who), 'X-Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const path = 'products/' + product + '/publication';
  const view = async () => {
    const r = await call(path);
    assert.equal(r.status, 200);
    return r.json() as Promise<PublicationView>;
  };
  async function action(
    op: string,
    extra: Record<string, unknown> = {},
    key = randomUUID(),
    who = 0,
  ) {
    const v = await view(),
      media = ['approve', 'revoke'].includes(op);
    return call(
      path + (media ? '/photos/' + photo : ''),
      {
        action: op,
        expectedVersion: media ? v.photos.find((x) => x.id === photo)!.version : v.version,
        reason: 'Review publication test decision',
        ...(op === 'approve' ? { alt: 'Charcoal cotton shirt, front view' } : {}),
        ...(op === 'publish'
          ? { expectedContentVersion: v.contentVersion, expectedProductVersion: v.productVersion }
          : {}),
        ...extra,
      },
      who,
      key,
    );
  }
  async function content(op: string) {
    const r = await call('products/' + product + '/content');
    assert.equal(r.status, 200);
    const v = await r.json();
    return call('products/' + product + '/content', {
      action: op,
      expectedVersion: v.record?.version ?? 0,
      expectedProductVersion: v.productVersion,
      ...(op === 'save'
        ? {
            profile: 'clothing-v2',
            slug,
            description: 'A soft cotton shirt.',
            merchandising: { sizeGuide: { id: guide, version: 1 }, collections: [] },
            specifications: {
              material: 'Cotton',
              care: 'Gentle wash',
              fit: 'regular',
              materialGroup: 'cotton',
              occasion: 'everyday',
            },
          }
        : {}),
      ...(op === 'approve' ? { reason: 'Owner explicit test review' } : {}),
    });
  }
  const publicProduct = () => fetch(base + '/api/v1/store/products/' + slug);
  const browse = (params: Record<string, string> = {}) =>
    fetch(base + '/api/v1/store/products?' + new URLSearchParams({ q: 'PUB' + suffix, ...params }));
  const browseTotal = async () => {
    const r = await browse();
    assert.equal(r.status, 200);
    return (await r.json()).total as number;
  };
  const publicPhoto = (size = 'image') =>
    fetch(base + '/api/v1/store/photos/' + photo + '/' + size);
  try {
    for (let i = 0; i < users.length; i++) {
      await db.query(
        "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Publication QA','not-a-login-hash',false)",
        [users[i], 'publication.test.' + suffix + i],
      );
      await db.query(
        'INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)',
        [users[i], tokenHash(tokens[i]!), csrf[i]],
      );
    }
    await db.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [users[0]],
    );
    for (let i = 0; i < roles.length; i++) {
      await db.query('INSERT INTO roles(id,code) VALUES($1,$2)', [
        roles[i],
        'publication_' + suffix + i,
      ]);
      await db.query(
        "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.read')",
        [roles[i]],
      );
      await db.query('INSERT INTO staff_role_assignments(staff_id,role_id) VALUES($1,$2)', [
        users[i + 1],
        roles[i],
      ]);
    }
    await db.query(
      "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.publish')",
      [roles[1]],
    );
    await db.query('INSERT INTO catalog_categories(id,name,name_key) VALUES($1,$2,$2)', [
      category,
      'publication ' + suffix,
    ]);
    await db.query(
      "INSERT INTO catalog_products(id,style_code,name,category_id,status,description) VALUES($1,$2,'Publication cotton shirt',$3,'active','INTERNAL operational note')",
      [product, 'PUB' + suffix.toUpperCase(), category],
    );
    await db.query(
      'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,129000,\'{"size":"M","color":"Red"}\')',
      [variant, product, 'PUB-' + suffix.toUpperCase(), 'e'.repeat(64)],
    );
    await db.query(
      'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,149000,$5::jsonb)',
      [
        secondVariant,
        product,
        'PUB-' + suffix.toUpperCase() + '-Z',
        'f'.repeat(64),
        JSON.stringify({ size: 'L', color: 'Blue' }),
      ],
    );
    const png = await sharp({
        create: { width: 48, height: 64, channels: 3, background: '#323b40' },
      })
        .png()
        .toBuffer(),
      image = await new ImageProcessor(readMediaPolicy(process.env)).process(png, 'image/png');
    await store.put(photo, image);
    const imageHash = createHash('sha256').update(image.image).digest('hex');
    await db.query(
      'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash,is_primary) VALUES($1,$2,$3,$4,$5,$6,true)',
      [photo, product, image.width, image.height, image.image.length, imageHash],
    );
    app = await createApp({
      ...process.env,
      HOST: '127.0.0.1',
      VIDEO_INTAKE_MODE: 'local-development',
      VIDEO_ARTIFACT_DIR: join(videoRoot, 'prepared'),
      STAFF_ORIGIN: origin,
    });
    app
      .getHttpServer()
      .prependListener('request', (req: { url?: string; headers: Record<string, unknown> }) => {
        if (req.url?.startsWith('/api/v1/'))
          publicRequests.push({
            path: req.url,
            cookie: !!req.headers.cookie,
            authorization: !!req.headers.authorization,
          });
      });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const guideDefinition = {
      title: 'Published shirt measurements',
      active: true,
      unit: 'cm',
      basis: 'garment',
      instructions: 'Measure the garment flat.',
      columns: ['Chest', 'Length'],
      rows: [
        { size: 'M', values: ['98.50', '72.00'] },
        { size: 'L', values: ['104.00', '74.00'] },
      ],
    };
    assert.equal(
      (
        await call('merchandising', {
          id: guide,
          kind: 'size_guide',
          slug: 'publication-guide-' + suffix,
          expectedVersion: 0,
          reason: 'Reviewed publication guide fixture',
          definition: guideDefinition,
        })
      ).status,
      200,
    );

    await t.test(
      'anonymous and ordinary staff cannot publish or approve images; original downloads stay private',
      async () => {
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
        assert.equal((await publicPhoto()).status, 404);
        assert.equal(
          (await fetch(base + '/api/v1/catalog/products/' + product + '/publication')).status,
          401,
        );
        assert.equal((await call(path, undefined, 1)).status, 200);
        assert.equal((await action('approve', {}, randomUUID(), 1)).status, 403);
        assert.equal((await action('approve', {}, randomUUID(), 2)).status, 403);
        assert.equal(
          (await fetch(base + '/api/v1/catalog/photos/' + photo + '/original')).status,
          401,
        );
        assert.equal((await publicPhoto('original')).status, 404);
        assert.equal(
          (await fetch(base + '/api/v1/store/photos/' + '-'.repeat(36) + '/image')).status,
          404,
        );
        const headers = h();
        delete (headers as Partial<typeof headers>)['X-CSRF-Token'];
        assert.equal(
          (
            await fetch(base + '/api/v1/catalog/' + path, {
              method: 'POST',
              headers,
              body: JSON.stringify({ action: 'unpublish', expectedVersion: 0, reason: 'blocked' }),
            })
          ).status,
          403,
        );
        for (const table of [
          'catalog_media_reviews',
          'catalog_releases',
          'catalog_publication_events',
          'catalog_publication_requests',
        ])
          await assert.rejects(runtime.query('DELETE FROM ' + table), /permission denied/);
      },
    );
    await t.test(
      'release refuses incomplete category and unapproved or missing photos',
      async () => {
        assert.equal((await action('publish')).status, 400);
        assert.equal(
          (
            await call('taxonomy', {
              id: category,
              expectedVersion: 0,
              name: 'Publication shirts ' + suffix,
              parentId: null,
              active: true,
              slug: 'publication-shirts-' + suffix,
              seo: { title: 'Shirts', description: '' },
              reason: 'Prepare category URL',
            })
          ).status,
          200,
        );
        for (const op of ['save', 'submit', 'approve'])
          assert.equal((await content(op)).status, 200);
        assert.equal((await action('publish')).status, 409);
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
      },
    );
    let approvalKey = randomUUID(),
      approvalBody: Record<string, unknown>;
    await t.test(
      'approval is versioned and concurrent identical retries create only one event',
      async () => {
        approvalBody = {
          action: 'approve',
          expectedVersion: 0,
          reason: 'Approve reviewed display copies',
          alt: 'Charcoal shirt front view',
        };
        const replies = await Promise.all([
          call(path + '/photos/' + photo, approvalBody, 0, approvalKey),
          call(path + '/photos/' + photo, approvalBody, 0, approvalKey),
        ]);
        assert.deepEqual(
          replies.map((r) => r.status),
          [200, 200],
        );
        assert.deepEqual(await replies[0]!.json(), await replies[1]!.json());
        assert.equal((await view()).photos[0]!.version, 1);
        assert.equal(
          (
            await call(
              path + '/photos/' + photo,
              { ...approvalBody, alt: 'Changed' },
              0,
              approvalKey,
            )
          ).status,
          409,
        );
        assert.equal((await action('approve', { expectedVersion: 0 })).status, 409);
      },
    );
    await t.test(
      'a second unreviewed active photo blocks publication even when the primary is approved',
      async () => {
        await db.query(
          'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash) VALUES($1,$2,48,64,$3,$4)',
          [secondPhoto, product, image.image.length, imageHash],
        );
        assert.ok((await view()).issues.some((x) => x.includes('every active photo')));
        await db.query('UPDATE catalog_product_photos SET is_active=false WHERE id=$1', [
          secondPhoto,
        ]);
      },
    );
    await t.test(
      'publish atomically snapshots a safe DTO and exposes verified derivative bytes only',
      async () => {
        assert.deepEqual((await view()).issues, []);
        assert.equal((await action('publish')).status, 200);
        const r = await publicProduct();
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const data = await r.json();
        assert.equal(data.variants[0].priceMinor, '129000');
        assert.equal(data.photos[0].alt, 'Charcoal shirt front view');
        assert.equal(data.photos[0].hash, undefined);
        assert.equal(data.productVersion, undefined);
        assert.equal(data.status, undefined);
        assert.equal(JSON.stringify(data).includes('INTERNAL'), false);
        assert.equal(JSON.stringify(data).includes('original'), false);
        assert.equal(JSON.stringify(data).includes('thumbnailHash'), false);
        for (const size of ['image', 'thumbnail']) {
          const r = await publicPhoto(size);
          assert.equal(r.status, 200);
          assert.equal(r.headers.get('content-type'), 'image/webp');
          assert.deepEqual(
            Buffer.from(await r.arrayBuffer()),
            size === 'image' ? image.image : image.thumbnail,
          );
        }
        assert.equal((await view()).effectivePublic, true);
      },
    );

    await t.test(
      'public navigation contains only categories with an eligible published release',
      async () => {
        const r = await fetch(base + '/api/v1/store/navigation');
        assert.equal(r.status, 200);
        const data = await r.json();
        assert.ok(data.items.some((x: { id: string }) => x.id === category));
        assert.ok(
          data.items.every((x: Record<string, unknown>) =>
            Object.keys(x).every((k) => ['id', 'slug', 'name', 'parentSlug'].includes(k)),
          ),
        );
      },
    );

    await t.test(
      'related products return no placeholders and reject unpublished sources or arbitrary parameters',
      async () => {
        const path = base + '/api/v1/store/products/' + slug + '/related',
          r = await fetch(path);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await r.json(), { items: [] });
        assert.equal((await fetch(path + '?limit=9999')).status, 400);
        assert.equal(
          (await fetch(base + '/api/v1/store/products/not-published-related/related')).status,
          404,
        );
        assert.equal((await fetch(base + '/api/v1/store/products/bad_slug/related')).status, 404);
      },
    );

    await t.test(
      'saved-product resolution reveals only eligible requested public cards and validates bounds',
      async () => {
        const url = base + '/api/v1/store/saved-products/resolve',
          resolve = async (productIds: unknown) =>
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productIds }),
            }),
          r = await resolve([randomUUID(), product]);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const b = await r.json();
        assert.deepEqual(
          b.items.map((p: { productId: string }) => p.productId),
          [product],
        );
        for (const key of ['supplier', 'hash', 'original', 'stock'])
          assert.ok(!JSON.stringify(b).includes(key));
        assert.deepEqual(await (await resolve([randomUUID()])).json(), { items: [] });
        assert.equal((await resolve([product, product])).status, 400);
        assert.equal((await resolve(Array.from({ length: 51 }, () => randomUUID()))).status, 400);
        assert.equal((await resolve(['invalid'])).status, 400);
        assert.equal(
          (
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: '{}',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(base + '/api/v1/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'published size-guide measurements stay pinned after a newer library revision',
      async () => {
        const r = await call('merchandising', {
          id: guide,
          kind: 'size_guide',
          slug: 'publication-guide-' + suffix,
          expectedVersion: 1,
          reason: 'New measurements require explicit reassignment',
          definition: {
            ...guideDefinition,
            rows: [
              { size: 'M', values: ['101.00', '73.00'] },
              { size: 'L', values: ['107.00', '75.00'] },
            ],
          },
        });
        assert.equal(r.status, 200);
        const publicReply = await publicProduct();
        assert.equal(publicReply.status, 200);
        const p = await publicReply.json();
        assert.equal(p.merchandising.sizeGuide.version, 1);
        assert.equal(p.merchandising.sizeGuide.definition.rows[0].values[0], '98.50');
      },
    );
    await verifyGalleryRelease({
      t,
      db,
      runtime,
      root: videoRoot,
      base,
      product,
      photo,
      slug,
      actor: users[0]!,
      publicRequests,
      call,
      publish: () => action('publish'),
      publicProduct,
    });
    await t.test('tampered display bytes are denied and prevent a new release', async () => {
      const file = join(store.root, photo + '-thumbnail.webp');
      try {
        await writeFile(file, Buffer.from('tampered'));
        assert.equal((await publicPhoto('thumbnail')).status, 404);
        assert.equal((await action('publish')).status, 409);
      } finally {
        await writeFile(file, image.thumbnail);
      }
      assert.equal((await publicPhoto('thumbnail')).status, 200);
    });
    await t.test(
      'public browse returns only approved cards and distinct-product facet counts',
      async () => {
        const r = await browse();
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.equal(r.headers.get('set-cookie'), null);
        const b = await r.json();
        assert.equal(b.total, 1);
        assert.equal(b.items.length, 1);
        assert.equal(b.currency, 'BDT');
        assert.equal(b.items[0].productId, product);
        assert.equal(b.items[0].matchingVariantCount, 2);
        assert.equal(b.items[0].matchingPriceMinMinor, '129000');
        assert.equal(b.items[0].matchingPriceMaxMinor, '149000');
        assert.deepEqual(b.facets.materialGroup, {
          items: [{ value: 'cotton', count: 1 }],
          truncated: false,
        });
        assert.deepEqual(b.facets.occasion, {
          items: [{ value: 'everyday', count: 1 }],
          truncated: false,
        });
        assert.deepEqual(b.facets.fit, {
          items: [{ value: 'regular', count: 1 }],
          truncated: false,
        });
        assert.deepEqual(b.facets.color.items, [
          { value: 'blue', count: 1 },
          { value: 'red', count: 1 },
        ]);
        assert.equal(b.items[0].photo.alt, 'Charcoal shirt front view');
        assert.equal(b.items[0].photo.thumbnailUrl, '/api/v1/store/photos/' + photo + '/thumbnail');
        assert.deepEqual(
          Object.keys(b.items[0]).sort(),
          [
            'productId',
            'slug',
            'name',
            'styleCode',
            'currency',
            'releaseVersion',
            'matchingVariantCount',
            'matchingPriceMinMinor',
            'matchingPriceMaxMinor',
            'photo',
          ].sort(),
        );
        for (const privateValue of [
          'INTERNAL',
          'hash',
          'original',
          'supplier',
          'stock',
          'description',
          'specifications',
        ])
          assert.equal(JSON.stringify(b).includes(privateValue), false);
      },
    );
    await t.test('size, color and price must match the same actual published SKU', async () => {
      for (const params of [
        { size: 'M', color: 'Blue' },
        { size: 'L', maxPriceMinor: '129000' },
        { size: 'M', minPriceMinor: '140000' },
        { fit: 'slim' },
        { materialGroup: 'linen' },
        { occasion: 'work' },
        { category: 'missing-' + suffix },
        { q: '%' + suffix },
        { q: "' OR 1=1 --" },
      ]) {
        const r = await browse(params);
        assert.equal(r.status, 200);
        const b = await r.json();
        assert.equal(b.total, 0);
        assert.deepEqual(b.items, []);
      }
      const r = await browse({
        size: '\uff2d ',
        color: ' RED ',
        fit: 'regular',
        category: 'publication-shirts-' + suffix,
        minPriceMinor: '129000',
        maxPriceMinor: '129000',
      });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.total, 1);
      assert.equal(b.items[0].matchingVariantCount, 1);
      assert.equal(b.items[0].matchingPriceMaxMinor, '129000');
      assert.deepEqual(b.facets.color.items, [{ value: 'red', count: 1 }]);
    });
    await t.test(
      'multiple published products sort by matching price with stable page order',
      async (sortingTest) => {
        for (let i = 0; i < sortingProducts.length; i++) {
          const pid = sortingProducts[i]!,
            ph = sortingPhotos[i]!,
            code = 'PUB' + suffix.toUpperCase() + '-SORT' + i;
          await db.query(
            "INSERT INTO catalog_products(id,style_code,name,category_id,status) VALUES($1,$2,$3,$4,'active')",
            [pid, code, i === 0 ? 'Aardvark sorted shirt' : 'Zebra sorted shirt', category],
          );
          await db.query(
            'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
            [
              randomUUID(),
              pid,
              code,
              'a'.repeat(64),
              i === 0 ? 209000 : 99000,
              JSON.stringify({ size: 'M', color: 'Red' }),
            ],
          );
          await store.put(ph, image);
          await db.query(
            'INSERT INTO catalog_product_photos(id,product_id,width,height,byte_size,content_hash,is_primary) VALUES($1,$2,$3,$4,$5,$6,true)',
            [ph, pid, image.width, image.height, image.image.length, imageHash],
          );
          for (const [version, op] of ['save', 'submit', 'approve'].entries()) {
            const r = await call('products/' + pid + '/content', {
              action: op,
              expectedVersion: version,
              expectedProductVersion: 1,
              ...(op === 'save'
                ? {
                    profile: 'clothing-v1',
                    slug: 'sort-shirt-' + suffix + '-' + i,
                    description: 'A sorting QA shirt.',
                    specifications: { material: 'Cotton', care: 'Gentle wash', fit: 'regular' },
                  }
                : {}),
              ...(op === 'approve' ? { reason: 'Review sorting fixture' } : {}),
            });
            assert.equal(r.status, 200);
          }
          assert.equal(
            (
              await call('products/' + pid + '/publication/photos/' + ph, {
                action: 'approve',
                expectedVersion: 0,
                reason: 'Approve sorting display image',
                alt: 'Sorting shirt front view',
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await call('products/' + pid + '/publication', {
                action: 'publish',
                expectedVersion: 0,
                expectedProductVersion: 1,
                expectedContentVersion: 3,
                reason: 'Publish sorting fixture',
              })
            ).status,
            200,
          );
        }
        try {
          for (const [sort, expected] of [
            ['name', [sortingProducts[0], product, sortingProducts[1]]],
            ['price_asc', [sortingProducts[1], product, sortingProducts[0]]],
            ['price_desc', [sortingProducts[0], product, sortingProducts[1]]],
          ] as const) {
            const r = await browse({ sort });
            assert.equal(r.status, 200);
            const b = await r.json();
            assert.equal(b.total, 3);
            assert.deepEqual(
              b.items.map((p: { productId: string }) => p.productId),
              expected,
            );
            assert.deepEqual(b.facets.fit.items, [{ value: 'regular', count: 3 }]);
            assert.deepEqual(b.facets.materialGroup.items, [{ value: 'cotton', count: 1 }]);
          }

          await sortingTest.test(
            'saved-product resolution preserves requested order across real releases',
            async () => {
              const ids = [sortingProducts[1]!, product, sortingProducts[0]!],
                r = await fetch(base + '/api/v1/store/saved-products/resolve', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ productIds: ids }),
                });
              assert.equal(r.status, 200);
              assert.deepEqual(
                (await r.json()).items.map((p: { productId: string }) => p.productId),
                ids,
              );
            },
          );
          await sortingTest.test(
            'similar products exclude the source and keep stable relevant prices and safe cards',
            async () => {
              const r = await fetch(base + '/api/v1/store/products/' + slug + '/related');
              assert.equal(r.status, 200);
              const b = await r.json();
              assert.deepEqual(
                b.items.map((p: { productId: string }) => p.productId),
                [sortingProducts[1], sortingProducts[0]],
              );
              assert.ok(b.items.every((p: { productId: string }) => p.productId !== product));
              assert.deepEqual(
                Object.keys(b.items[0]).sort(),
                [
                  'productId',
                  'slug',
                  'name',
                  'styleCode',
                  'currency',
                  'releaseVersion',
                  'matchingVariantCount',
                  'matchingPriceMinMinor',
                  'matchingPriceMaxMinor',
                  'photo',
                ].sort(),
              );
              for (const v of ['supplier', 'hash', 'original', 'stock', 'specifications'])
                assert.ok(!JSON.stringify(b).includes(v));
            },
          );
          await sortingTest.test(
            'Next similar-product rail uses real releases and removes a withdrawn recommendation on the next read',
            async () => {
              const origin = await openStorefrontFixture(sortingTest, base),
                read = async () => {
                  const r = await fetch(origin + '/products/' + slug);
                  assert.equal(r.status, 200);
                  return (
                    (await r.text()).match(
                      /<section[^>]*aria-label="Similar products"[\s\S]*?<\/section>/,
                    )?.[0] ?? ''
                  );
                };
              let html = await read();
              assert.ok(html.includes('Aardvark sorted shirt'));
              assert.ok(html.includes('Zebra sorted shirt'));
              assert.ok(!html.includes('Publication cotton shirt'));
              const pid = sortingProducts[1]!,
                pub = await (await call('products/' + pid + '/publication')).json();
              assert.equal(
                (
                  await call('products/' + pid + '/publication', {
                    action: 'unpublish',
                    expectedVersion: pub.version,
                    reason: 'Withdraw recommendation fixture',
                  })
                ).status,
                200,
              );
              html = await read();
              assert.ok(!html.includes('Zebra sorted shirt'));
              assert.ok(html.includes('Aardvark sorted shirt'));
              const next = await (await call('products/' + pid + '/publication')).json();
              assert.equal(
                (
                  await call('products/' + pid + '/publication', {
                    action: 'publish',
                    expectedVersion: next.version,
                    expectedProductVersion: next.productVersion,
                    expectedContentVersion: next.contentVersion,
                    reason: 'Restore fixture before cleanup',
                  })
                ).status,
                200,
              );
            },
          );
        } finally {
          // Keep subsequent withdrawal/history tests scoped to the original single product.
          for (const pid of sortingProducts) {
            const current = await (await call('products/' + pid + '/publication')).json();
            const r = await call('products/' + pid + '/publication', {
              action: 'unpublish',
              expectedVersion: current.version,
              reason: 'End isolated sorting fixture',
            });
            assert.equal(r.status, 200);
          }
        }
      },
    );
    await t.test('browse pagination keeps total and facets even beyond the last page', async () => {
      for (const sort of ['name', 'price_asc', 'price_desc']) {
        const r = await browse({ page: '2', pageSize: '12', sort });
        assert.equal(r.status, 200);
        const b = await r.json();
        assert.equal(b.total, 1);
        assert.deepEqual(b.items, []);
        assert.equal(b.hasMore, false);
        assert.equal(b.page, 2);
        assert.equal(b.facets.fit.items[0].count, 1);
      }
    });
    await t.test('anonymous browse rejects duplicate, unknown and oversized filters', async () => {
      for (const qs of [
        'size=M&size=L',
        'page=1001',
        'includeDrafts=true',
        'sort=random',
        'pageSize=500',
        'minPriceMinor=10&maxPriceMinor=1',
        'q=' + 'x'.repeat(81),
      ])
        assert.equal((await fetch(base + '/api/v1/store/products?' + qs)).status, 400);
    });
    await t.test(
      'changed live prices block the released DTO and image without overwriting release history',
      async () => {
        const [before] = await db.query(
          'SELECT snapshot FROM catalog_releases WHERE product_id=$1',
          [product],
        );
        await db.query('UPDATE catalog_variants SET price_minor=139000 WHERE id=$1', [variant]);
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
        assert.equal((await publicPhoto()).status, 404);
        assert.equal((await view()).effectivePublic, false);
        assert.deepEqual(
          (
            await db.query('SELECT snapshot FROM catalog_releases WHERE product_id=$1', [product])
          )[0],
          before,
        );
        await db.query('UPDATE catalog_variants SET price_minor=129000 WHERE id=$1', [variant]);
        assert.equal((await publicProduct()).status, 200);
      },
    );
    await t.test(
      'revoking a photo closes public access and reapproval requires a new explicit release',
      async () => {
        assert.equal((await action('revoke')).status, 200);
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
        assert.equal((await publicPhoto()).status, 404);
        assert.equal((await action('approve')).status, 200);
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
        assert.equal((await action('publish')).status, 200);
        assert.equal((await publicProduct()).status, 200);
      },
    );

    await t.test(
      'concurrent publication and approval revocation always finish with public access closed',
      async () => {
        const [publishing, revoking] = await Promise.all([action('publish'), action('revoke')]);
        assert.ok([200, 409].includes(publishing.status));
        assert.equal(revoking.status, 200);
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
        assert.equal((await publicPhoto()).status, 404);
        assert.equal((await action('approve')).status, 200);
        assert.equal((await action('publish')).status, 200);
      },
    );
    await t.test(
      'audit failure rolls back a withdrawal and leaves its retry key usable',
      async () => {
        await db.query(
          "CREATE FUNCTION publication_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='catalog.unpublish' THEN RAISE EXCEPTION 'forced publication audit';END IF;RETURN NEW;END;$$;CREATE TRIGGER publication_test_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION publication_test_audit_fail();",
        );
        try {
          assert.equal((await action('unpublish')).status, 500);
          assert.equal((await publicProduct()).status, 200);
        } finally {
          await db.query(
            'DROP TRIGGER publication_test_audit_fail ON audit_events;DROP FUNCTION publication_test_audit_fail()',
          );
        }
      },
    );
    await t.test(
      'withdrawal immediately denies both sizes, preserves history and checks fresh permissions on replay',
      async () => {
        const v = await view(),
          key = randomUUID(),
          body = {
            action: 'unpublish',
            expectedVersion: v.version,
            reason: 'Withdraw reviewed product',
          };
        assert.equal((await call(path, body, 0, key)).status, 200);
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
        assert.equal((await publicPhoto()).status, 404);
        assert.equal((await publicPhoto('thumbnail')).status, 404);
        assert.equal((await call(path, body, 0, key)).status, 200);
        await db.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [users[0]]);
        assert.equal((await call(path, body, 0, key)).status, 403);
        await db.query(
          "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
          [users[0]],
        );
        assert.ok((await view()).history.length >= 6);
      },
    );
    await t.test(
      'category URL changes also suppress an old release and cannot silently rewrite navigation',
      async () => {
        assert.equal((await action('publish')).status, 200);
        await db.query(
          "INSERT INTO catalog_category_routes(slug,category_id) VALUES('new-publication-'||$2,$1)",
          [category, suffix],
        );
        await db.query(
          "UPDATE catalog_category_presentation SET slug='new-publication-'||$2 WHERE category_id=$1",
          [category, suffix],
        );
        assert.equal((await publicProduct()).status, 404);
        assert.equal(await browseTotal(), 0);
        assert.equal((await action('unpublish')).status, 200);
      },
    );
    await t.test(
      'migration preserves prior content fingerprints and refuses discarding publication history',
      async () => {
        const r = db.createQueryRunner(),
          migration = new CatalogPublication1794117000000();
        await r.connect();
        try {
          await assert.rejects(migration.down(r), /Cannot discard/);
          await r.startTransaction();
          const schema = 'publication_scratch_' + suffix;
          await r.query('CREATE SCHEMA ' + schema);
          await r.query('SET LOCAL search_path TO ' + schema + ',public');
          for (const prior of db.migrations) {
            if (prior instanceof CatalogPublication1794117000000) break;
            await prior.up(r);
          }
          await r.query(
            "INSERT INTO catalog_products(id,style_code,name,status) VALUES($1,'UNCHANGED','Existing draft','draft')",
            [product],
          );
          const before = await r.query('SELECT catalog_content_snapshot($1) AS snapshot', [
            product,
          ]);
          await migration.up(r);
          assert.equal(
            (
              await r.query(
                "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN('catalog_releases_slug_idx','catalog_publication_history_idx')",
              )
            )[0].n,
            2,
          );
          assert.deepEqual(
            await r.query('SELECT catalog_content_snapshot($1) AS snapshot', [product]),
            before,
          );
          await migration.down(r);
          assert.equal((await r.query('SELECT version FROM app_schema_version'))[0].version, 18);
          await migration.up(r);
          await r.rollbackTransaction();
        } finally {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
      },
    );
  } finally {
    await app?.close();
    await runtime.destroy();
    await db.transaction(async (m) => {
      for (const pid of sortingProducts) {
        await m.query('DELETE FROM catalog_publication_events WHERE product_id=$1', [pid]);
        await m.query('DELETE FROM catalog_releases WHERE product_id=$1', [pid]);
        await m.query(
          'DELETE FROM catalog_media_reviews WHERE photo_id IN(SELECT id FROM catalog_product_photos WHERE product_id=$1)',
          [pid],
        );
        for (const table of [
          'catalog_content_requests',
          'catalog_content_events',
          'catalog_product_content',
          'catalog_merch_links',
          'catalog_media_requests',
          'catalog_product_seo',
        ])
          await m.query('DELETE FROM ' + table + ' WHERE product_id=$1', [pid]);
        await m.query('DELETE FROM catalog_product_photos WHERE product_id=$1', [pid]);
        await m.query('DELETE FROM catalog_variants WHERE product_id=$1', [pid]);
        await m.query('DELETE FROM catalog_products WHERE id=$1', [pid]);
      }
      await m.query('DELETE FROM catalog_publication_requests WHERE actor_id=ANY($1::uuid[])', [
        users,
      ]);
      for (const table of ['catalog_gallery_review_requests', 'catalog_gallery_requests'])
        await m.query('DELETE FROM ' + table + ' WHERE actor_id=ANY($1::uuid[])', [users]);
      for (const table of [
        'catalog_gallery_review_events',
        'catalog_gallery_reviews',
        'catalog_gallery_events',
        'catalog_gallery_drafts',
      ])
        await m.query('DELETE FROM ' + table + ' WHERE product_id=$1', [product]);
      await m.query(
        'DELETE FROM catalog_video_events WHERE video_id IN(SELECT id FROM catalog_product_videos WHERE product_id=$1)',
        [product],
      );
      await m.query('DELETE FROM catalog_product_videos WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_publication_events WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_releases WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_media_reviews WHERE photo_id IN($1,$2)', [
        photo,
        secondPhoto,
      ]);
      for (const table of [
        'catalog_content_requests',
        'catalog_content_events',
        'catalog_product_content',
        'catalog_merch_links',
        'catalog_media_requests',
        'catalog_product_seo',
      ])
        await m.query('DELETE FROM ' + table + ' WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_presentation_requests WHERE actor_id=ANY($1::uuid[])', [
        users,
      ]);
      await m.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM catalog_product_photos WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_variants WHERE product_id=$1', [product]);
      await m.query('DELETE FROM catalog_products WHERE id=$1', [product]);
      for (const table of [
        'catalog_category_events',
        'catalog_category_presentation',
        'catalog_category_routes',
      ])
        await m.query('DELETE FROM ' + table + ' WHERE category_id=$1', [category]);
      await m.query('DELETE FROM catalog_categories WHERE id=$1', [category]);
      await m.query('DELETE FROM catalog_merch_requests WHERE actor_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM catalog_merch_versions WHERE item_id=$1', [guide]);
      await m.query('DELETE FROM catalog_merch_items WHERE id=$1', [guide]);
      await m.query('DELETE FROM staff_sessions WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM staff_role_assignments WHERE staff_id=ANY($1::uuid[])', [users]);
      await m.query('DELETE FROM role_permissions WHERE role_id=ANY($1::uuid[])', [roles]);
      await m.query('DELETE FROM roles WHERE id=ANY($1::uuid[])', [roles]);
      await m.query('DELETE FROM staff_users WHERE id=ANY($1::uuid[])', [users]);
    });
    await store.discard(photo);
    await store.discard(secondPhoto);
    for (const id of sortingPhotos) await store.discard(id);
    await db.destroy();
    if (!videoRoot.startsWith(join(tmpdir(), 'commerce-gallery-release-')))
      throw Error('Unsafe gallery test cleanup');
    await rm(videoRoot, { recursive: true, force: true });
  }
});
