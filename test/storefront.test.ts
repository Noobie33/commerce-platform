import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  shopQuery,
  apiOrigin,
  mediaTarget,
  shopLink,
} from '../apps/storefront/src/lib/store-query.js';
import {
  parseProduct,
  productSelection,
  parseBrowse,
  money,
  jsonLd,
  parseNavigation,
} from '../apps/storefront/src/lib/catalog-contract.js';
test('storefront filters use exact minor-unit prices and reject duplicate or ambiguous inputs', () => {
  assert.match(
    shopQuery({ minPrice: '1290.01', maxPrice: '9999999999.99', size: 'M' }).api,
    /minPriceMinor=129001/,
  );
  assert.match(shopQuery({ minPrice: '0.01' }).api, /minPriceMinor=1/);
  for (const q of [
    { minPrice: '1e3' },
    { minPrice: '-1' },
    { minPrice: '1.001' },
    { minPrice: '10', maxPrice: '9' },
    { size: ['M', 'L'] },
    { password: 'x' },
    { page: '0' },
    { category: '../staff' },
  ])
    assert.throws(() => shopQuery(q));
  assert.equal(shopLink({ size: 'M', page: '4' }, { size: null, page: null }), '/shop');
  assert.equal(money('129001'), String.fromCharCode(0x09f3) + ' 1,290.01');
});
test('storefront API and media boundaries reject external origins, originals and staff routes', () => {
  assert.equal(apiOrigin('http://127.0.0.1:4000'), 'http://127.0.0.1:4000');
  for (const u of [
    'https://example.com',
    'http://user:pass@127.0.0.1:4000',
    'http://127.0.0.1/private',
    'http://127.0.0.1?secret=1',
    'file:///private',
  ])
    assert.throws(() => apiOrigin(u));
  const id = randomUUID();
  assert.ok(mediaTarget(['photos', id, 'image']));
  assert.ok(mediaTarget(['products', 'shirt', 'media', '2', id, 'playback']));
  for (const p of [
    ['photos', id, 'original'],
    ['catalog', 'photos', id, 'image'],
    ['https:', 'example.com'],
    ['products', 'shirt', 'media', '0', id, 'playback'],
    ['products', 'shirt', 'media', '999999999999', id, 'playback'],
  ])
    assert.equal(mediaTarget(p), null);
});
test('storefront child environment contains public settings and never database or authorization credentials', async () => {
  const { publicStoreEnvironment } = await import(
    pathToFileURL(resolve('src/scripts/storefront-process.mjs')).href
  );
  const env = publicStoreEnvironment(
    {
      PATH: 'known',
      DATABASE_URL: 'not-for-store',
      MIGRATION_DATABASE_URL: 'not-for-store',
      PGPASSWORD: 'not-for-store',
      GITHUB_TOKEN: 'not-for-store',
      AUTHORIZATION: 'not-for-store',
    },
    { STORE_API_ORIGIN: 'http://127.0.0.1:4000', STORE_BRAND_NAME: 'Our label' },
  );
  assert.equal(env.STORE_BRAND_NAME, 'Our label');
  assert.equal(env.PATH, 'known');
  for (const k of [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'PGPASSWORD',
    'GITHUB_TOKEN',
    'AUTHORIZATION',
  ])
    assert.equal(k in env, false);
  assert.throws(() => publicStoreEnvironment({}, { STORE_API_ORIGIN: 'http://remote.example' }));
});
const id = randomUUID(),
  video = randomUUID(),
  slug = 'cotton-shirt',
  photo = {
    kind: 'photo',
    id,
    label: 'Cotton shirt front',
    width: 480,
    height: 600,
    url: '/api/v1/store/photos/' + id + '/image',
    thumbnailUrl: '/api/v1/store/photos/' + id + '/thumbnail',
  },
  product = {
    productId: randomUUID(),
    slug,
    name: 'Cotton shirt',
    styleCode: 'SHIRT-1',
    currency: 'BDT',
    description: 'A product description',
    specifications: { material: 'Cotton' },
    variants: [
      {
        id: randomUUID(),
        sku: 'SHIRT-M',
        priceMinor: '129000',
        attributes: { size: 'M' },
        purchaseCost: 'private',
      },
    ],
    gallery: [
      photo,
      {
        kind: 'video',
        id: video,
        label: 'Portrait view',
        width: 180,
        height: 320,
        hasAudio: false,
        durationSeconds: 1,
        url: '/api/v1/store/products/' + slug + '/media/2/' + video + '/playback',
        thumbnailUrl: '/api/v1/store/products/' + slug + '/media/2/' + video + '/poster',
      },
    ],
    categoryPath: [{ id: randomUUID(), slug: 'shirts', name: 'Shirts' }],
    releaseVersion: 2,
    seo: {},
    staffNote: 'private',
  };
test('storefront public adapter preserves native image/video ratios and discards private additions', () => {
  const p = parseProduct(product);
  assert.equal(p.gallery[0]!.width / p.gallery[0]!.height, 4 / 5);
  assert.equal(p.gallery[1]!.width / p.gallery[1]!.height, 9 / 16);
  assert.ok(p.gallery[1]!.url.startsWith('/media/products/'));
  assert.ok(!JSON.stringify(p).includes('private'));
  assert.throws(() =>
    parseProduct({ ...product, gallery: [{ ...photo, url: 'https://example.com/private' }] }),
  );
  assert.throws(() => parseProduct({ ...product, gallery: [{ ...photo, width: 0 }] }));
});
test('storefront browse and navigation expose only explicit display fields', () => {
  const facets = Object.fromEntries(
      ['size', 'color', 'fit', 'materialGroup', 'occasion'].map((k) => [
        k,
        { items: [], truncated: false },
      ]),
    ),
    v = parseBrowse({
      items: [
        {
          productId: product.productId,
          slug,
          name: product.name,
          styleCode: 'SHIRT-1',
          currency: 'BDT',
          releaseVersion: 2,
          matchingVariantCount: 1,
          matchingPriceMinMinor: '129000',
          matchingPriceMaxMinor: '129000',
          photo: { id, alt: 'Front', width: 480, height: 600, thumbnailUrl: photo.thumbnailUrl },
          supplier: 'private',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 24,
      hasMore: false,
      currency: 'BDT',
      facets,
    });
  assert.ok(!JSON.stringify(v).includes('private'));
  assert.equal(
    parseNavigation({
      items: [{ id, slug: 'shirts', name: 'Shirts', parentSlug: null, internal: 'private' }],
    })[0]!.slug,
    'shirts',
  );
});
test('product structured data cannot terminate its HTML script element', () => {
  const value = { name: '</script><script>alert(1)</script>&' };
  const safe = jsonLd(value);
  assert.ok(!safe.includes('<'));
  assert.ok(!safe.includes('&'));
  assert.deepEqual(JSON.parse(safe), value);
});

test('product selection keeps one real SKU combination and discards unrelated URL parameters', () => {
  const p = {
    ...parseProduct(product),
    variants: [
      {
        id: randomUUID(),
        sku: 'RED-M',
        priceMinor: '129000',
        attributes: { size: 'M', color: 'Red' },
      },
      {
        id: randomUUID(),
        sku: 'BLUE-L',
        priceMinor: '149000',
        attributes: { size: 'L', color: 'Blue' },
      },
    ],
  };
  assert.deepEqual(
    productSelection(p, { size: 'm', color: 'rEd', q: 'other', sort: 'price_desc' }),
    { size: 'M', color: 'Red' },
  );
  assert.deepEqual(productSelection(p, { size: 'L', color: 'Red' }), {});
  assert.deepEqual(productSelection(p, { size: ['M', 'L'], color: 'missing', q: 'other' }), {});
  assert.deepEqual(productSelection(p, { size: 'L', color: 'blue' }), { size: 'L', color: 'Blue' });
});

test('public size-guide parsing preserves exact units and measurements and rejects malformed or retired charts', () => {
  const definition = {
      title: 'Shirt measurements',
      active: true,
      unit: 'in',
      basis: 'body',
      instructions: 'Measure around your chest.',
      columns: ['Chest'],
      rows: [{ size: 'M', values: ['38.50'] }],
    },
    guide = {
      id: randomUUID(),
      kind: 'size_guide',
      active: true,
      version: 3,
      definition,
      privateNotes: 'not public',
    };
  const parsed = parseProduct({
    ...product,
    merchandising: { sizeGuide: guide, collections: [] },
  }).sizeGuide!;
  assert.equal(parsed.rows[0]!.values[0], '38.50');
  assert.equal(parsed.unit, 'in');
  assert.equal(parsed.basis, 'body');
  assert.ok(!JSON.stringify(parsed).includes('not public'));
  assert.equal(parseProduct(product).sizeGuide, null);
  for (const d of [
    { ...definition, unit: 'mm' },
    { ...definition, basis: 'guess' },
    { ...definition, active: false },
    { ...definition, rows: [{ size: 'M', values: ['0.00'] }] },
    { ...definition, rows: [{ size: 'M', values: ['1.234'] }] },
    { ...definition, rows: [{ size: 'M', values: [] }] },
  ])
    assert.throws(() =>
      parseProduct({ ...product, merchandising: { sizeGuide: { ...guide, definition: d } } }),
    );
  assert.throws(() =>
    parseProduct({ ...product, merchandising: { sizeGuide: { ...guide, active: false } } }),
  );
});
