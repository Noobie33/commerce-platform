// Persistent local demo fixtures. Never run against development or test business databases.
import { PasswordService } from '../../dist/src/modules/identity/password.service.js';
const relatedProducts = [],
  otherCategory = randomUUID();
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import {
  createDataSource,
  databaseUrl,
} from '../../dist/src/infrastructure/database/data-source.js';
import { createApp } from '../../dist/src/app.js';
import { tokenHash } from '../../dist/src/modules/identity/identity.service.js';
import {
  videoWorkerSource,
  assertVideoWorker,
  VideoWorker,
} from '../../dist/src/modules/catalog/video-worker.js';
import { runMediaProcess } from '../../dist/src/infrastructure/media/bounded-media-process.js';
import { ProductMediaService } from '../../dist/src/modules/catalog/media.service.js';
import { ImageProcessor } from '../../dist/src/infrastructure/media/image-processor.js';
import { readMediaPolicy } from '../../dist/src/infrastructure/media/media-policy.js';
import { LocalMediaStore } from '../../dist/src/infrastructure/media/local-media.store.js';
if (
  new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname !== '/commerce_platform_demo'
)
  throw Error('Separate demo database required');
const demoCsrf = randomBytes(32).toString('hex');
const db = createDataSource(),
  cfg = parseEnv(await readFile('.env.video-worker.demo', 'utf8')),
  id = randomUUID(),
  actor = randomUUID(),
  product = randomUUID(),
  variant = randomUUID(),
  guide = randomUUID(),
  category = randomUUID(),
  suffix = randomBytes(4).toString('hex'),
  token = randomBytes(32).toString('base64url'),
  root = path.resolve('.local-setup/demo-source-' + id),
  env = {
    ...process.env,
    ...cfg,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    VIDEO_INTAKE_MODE: 'local-development',
  },
  workerDb = videoWorkerSource(env),
  mediaStore = new LocalMediaStore(process.env),
  abort = new AbortController();
let app,
  photos = [],
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  abort.abort();
  await app?.close();
  if (workerDb.isInitialized) await workerDb.destroy();
  if (db.isInitialized) await db.destroy();
}
try {
  await db.initialize();
  if (
    (await db.query('SELECT 1 FROM catalog_products LIMIT 1')).length ||
    (await db.query('SELECT 1 FROM staff_users LIMIT 1')).length
  )
    throw Error('Demo already contains data; refused reseed');
  await mkdir(root);
  await workerDb.initialize();
  await assertVideoWorker(workerDb);
  const demoPassword = randomBytes(24).toString('base64url');
  await writeFile(
    '.local-setup/demo-login.txt',
    'Local demo only\nAddress: http://127.0.0.1:4100/admin\nUsername: demo.owner\nPassword: ' +
      demoPassword +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await db.query(
    "INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES($1,'demo.owner','Demo owner',$2,false)",
    [actor, await new PasswordService().hash(demoPassword)],
  );
  await db.query(
    "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
    [actor],
  );
  await db.query('INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES($1,$2,$3)', [
    actor,
    tokenHash(token),
    demoCsrf,
  ]);
  await db.query('INSERT INTO catalog_categories(id,name,name_key) VALUES($1,$2,$3)', [
    category,
    'Everyday clothing (sample) ' + suffix,
    'video qa clothing ' + suffix,
  ]);
  await db.query(
    "INSERT INTO catalog_products(id,style_code,name,category_id,status) VALUES($1,$2,'Charcoal everyday tee (sample)',$3,'active')",
    [product, 'DEMOVIDEO' + suffix.toUpperCase(), category],
  );
  await db.query(
    'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,129000,$5::jsonb)',
    [
      variant,
      product,
      'DEMOVIDEO-' + suffix.toUpperCase(),
      'b'.repeat(64),
      JSON.stringify({ size: 'M', color: 'Charcoal' }),
    ],
  );
  await db.query(
    'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,149000,$5::jsonb)',
    [
      randomUUID(),
      product,
      'DEMOVIDEO-' + suffix.toUpperCase() + '-L',
      'c'.repeat(64),
      JSON.stringify({ size: 'L', color: 'Navy' }),
    ],
  );
  const svg =
      '<svg width="400" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="480" fill="#f5f4f2"/><path d="M135 100L70 145L105 205L130 190L130 390L270 390L270 190L295 205L330 145L265 100L235 90Q200 125 165 90Z" fill="#373b3c"/><path d="M165 90Q200 150 235 90" fill="none" stroke="#252829" stroke-width="12"/><text x="200" y="445" text-anchor="middle" font-family="Arial" font-size="14" fill="#737373">DEMO / SAMPLE PRODUCT</text></svg>',
    png = await sharp(Buffer.from(svg), { density: 216 }).png().toBuffer(),
    pngFile = path.join(root, 'product.png'),
    clipFile = path.join(root, 'product-clip.mp4');
  await writeFile(pngFile, png);
  const media = new ProductMediaService(
    db,
    new ImageProcessor(readMediaPolicy(process.env)),
    mediaStore,
  );
  photos = (await media.upload(product, 1, randomUUID(), actor, randomUUID(), png, 'image/png'))
    .photos;
  await runMediaProcess(
    env.FFMPEG_PATH,
    [
      '-v',
      'error',
      '-nostdin',
      '-n',
      '-loop',
      '1',
      '-i',
      pngFile,
      '-vf',
      'scale=400:480,pad=432:768:16:144:color=0xf5f4f2',
      '-t',
      '1.2',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      clipFile,
    ],
    10000,
  );
  app = await createApp({ ...env, STAFF_ORIGIN: 'http://127.0.0.1:4100' });
  await app.listen(4100, '127.0.0.1');
  const worker = new VideoWorker(workerDb, env);
  const h = {
    Origin: 'http://127.0.0.1:4100',
    'X-Requested-With': 'commerce-staff',
    'X-CSRF-Token': demoCsrf,
    Cookie: 'commerce_demo_session=' + token,
    'X-Idempotency-Key': randomUUID(),
  };
  async function post(p, b) {
    const r = await fetch('http://127.0.0.1:4100/api/v1/catalog/' + p, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json', 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify(b),
    });
    if (!r.ok) {
      console.error('Demo DEMO request rejected: ' + p + ' status ' + r.status);
      throw Error('DEMO action failed');
    }
    return r.json();
  }
  const definition = {
    title: 'Generated shirt size guide',
    active: true,
    unit: 'cm',
    basis: 'garment',
    instructions: 'Measure the garment flat. These are sample test measurements.',
    columns: ['Chest', 'Length', 'Shoulder', 'Sleeve', 'Waist', 'Hem'],
    rows: [
      { size: 'M', values: ['98.50', '72.00', '44.00', '62.00', '94.00', '98.00'] },
      { size: 'L', values: ['104.00', '74.00', '46.00', '64.00', '98.00', '104.00'] },
    ],
  };
  await post('merchandising', {
    id: guide,
    kind: 'size_guide',
    slug: 'photo-guide-' + suffix,
    expectedVersion: 0,
    definition,
    reason: 'Generated chart for demo public guide DEMO',
  });
  await post('products/' + product + '/publication/photos/' + photos[0].id, {
    action: 'approve',
    expectedVersion: 0,
    reason: 'Fictional photo for gallery acceptance',
    alt: 'Charcoal cotton shirt front view',
  });
  const upload = await fetch(
    'http://127.0.0.1:4100/api/v1/catalog/products/' + product + '/videos',
    {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'video/mp4', 'X-Product-Version': '2' },
      body: new Uint8Array(await readFile(clipFile)),
    },
  );
  if (!upload.ok) throw Error('DEMO upload failed');
  const uploaded = await upload.json();
  await worker.once();
  const videos = await (
      await fetch('http://127.0.0.1:4100/api/v1/catalog/products/' + product + '/videos', {
        headers: h,
      })
    ).json(),
    v = videos.items.find((v) => v.id === uploaded.id);
  if (v.state !== 'ready') throw Error('DEMO video was not prepared');
  await post('videos/' + v.id, {
    action: 'metadata',
    expectedVersion: v.version,
    reason: 'Fictional gallery video details',
    description: 'Charcoal cotton shirt turn view',
    variantId: variant,
    position: 0,
  });
  await post('videos/' + v.id + '/review', {
    action: 'approve',
    expectedVersion: v.version + 1,
    reason: 'Own generated fictional clip for demo gallery acceptance',
    rightsConfirmed: true,
  });
  await post('taxonomy', {
    id: category,
    expectedVersion: 0,
    name: 'Everyday clothing (sample) ' + suffix,
    parentId: null,
    active: true,
    slug: 'gallery-qa-' + suffix,
    seo: { title: 'Gallery DEMO', description: '' },
    reason: 'Prepare sample public gallery fixture',
  });
  for (const action of ['save', 'submit', 'approve']) {
    const r = await (
      await fetch('http://127.0.0.1:4100/api/v1/catalog/products/' + product + '/content', {
        headers: h,
      })
    ).json();
    await post('products/' + product + '/content', {
      action,
      expectedVersion: r.record?.version ?? 0,
      expectedProductVersion: r.productVersion,
      ...(action === 'save'
        ? {
            profile: 'clothing-v2',
            slug: 'gallery-qa-shirt-' + suffix,
            description: 'Generated product for gallery release acceptance.',
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
      ...(action === 'approve' ? { reason: 'Explicit sample content review' } : {}),
    });
  }

  const gp = 'products/' + product + '/gallery';
  let g = await (await fetch('http://127.0.0.1:4100/api/v1/catalog/' + gp, { headers: h })).json();
  await post(gp, {
    action: 'save',
    expectedVersion: g.version,
    expectedBasis: g.basis,
    reason: 'Fictional storefront visual verification',
    items: [
      { kind: 'photo', id: photos[0].id },
      { kind: 'video', id: v.id },
    ],
  });
  g = await (await fetch('http://127.0.0.1:4100/api/v1/catalog/' + gp, { headers: h })).json();
  await post(gp + '/review', {
    action: 'approve',
    expectedVersion: g.publicReview.version,
    expectedDraftVersion: g.publicReview.currentDraftVersion,
    expectedBasis: g.publicReview.currentBasis,
    rightsConfirmed: true,
    reason: 'Own generated storefront DEMO media reviewed',
  });
  const pp = 'products/' + product + '/publication',
    pv = await (await fetch('http://127.0.0.1:4100/api/v1/catalog/' + pp, { headers: h })).json();
  await post(pp, {
    action: 'publish',
    expectedVersion: pv.version,
    expectedContentVersion: pv.contentVersion,
    expectedProductVersion: pv.productVersion,
    reason: 'Publish demo fictional storefront preview',
  });
  await post('merchandising', {
    id: guide,
    kind: 'size_guide',
    slug: 'photo-guide-' + suffix,
    expectedVersion: 1,
    definition: {
      ...definition,
      rows: definition.rows.map((r) => ({ ...r, values: ['101.00', ...r.values.slice(1)] })),
    },
    reason: 'New draft measurements do not overwrite pinned release',
  });

  await db.query('INSERT INTO catalog_categories(id,name,name_key) VALUES($1,$2,$3)', [
    otherCategory,
    'Lifestyle (sample) ' + suffix,
    'other generated clothing ' + suffix,
  ]);
  await post('taxonomy', {
    id: otherCategory,
    expectedVersion: 0,
    name: 'Lifestyle (sample) ' + suffix,
    parentId: null,
    active: true,
    slug: 'other-related-qa-' + suffix,
    seo: { title: 'Lifestyle (sample)', description: '' },
    reason: 'Isolated unrelated category',
  });
  const colours = [
    '#526455',
    '#a08561',
    '#748ca0',
    '#99777b',
    '#4e5260',
    '#b6a78d',
    '#877160',
    '#677d76',
  ];
  for (let i = 0; i < 8; i++) {
    const pid = randomUUID(),
      sku = 'RELDEMO-' + suffix.toUpperCase() + '-' + i;
    relatedProducts.push(pid);
    const unrelated = i === 6,
      hidden = i === 7,
      name = unrelated
        ? 'Generated separate-category shirt'
        : hidden
          ? 'Generated hidden draft shirt'
          : 'Everyday tee (sample) ' + String(i + 1).padStart(2, '0');
    await db.query(
      "INSERT INTO catalog_products(id,style_code,name,category_id,status) VALUES($1,$2,$3,$4,'active')",
      [pid, sku, name, unrelated ? otherCategory : category],
    );
    await db.query(
      'INSERT INTO catalog_variants(id,product_id,sku,options_key,price_minor,attributes) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [
        randomUUID(),
        pid,
        sku,
        randomBytes(32).toString('hex'),
        [119000, 139000, 169000, 189000, 209000, 99000, 129000, 129000][i],
        JSON.stringify({ size: 'M', color: 'Generated' }),
      ],
    );
    const file = await sharp(Buffer.from(svg.replace('#373b3c', colours[i])), { density: 216 })
        .png()
        .toBuffer(),
      owned = (await media.upload(pid, 1, randomUUID(), actor, randomUUID(), file, 'image/png'))
        .photos;
    photos.push(...owned);
    if (hidden) continue;
    await post('products/' + pid + '/publication/photos/' + owned[0].id, {
      action: 'approve',
      expectedVersion: 0,
      reason: 'Own generated related-product photo',
      alt: name + ' front view',
    });
    for (const action of ['save', 'submit', 'approve']) {
      const cv = await (
        await fetch('http://127.0.0.1:4100/api/v1/catalog/products/' + pid + '/content', {
          headers: h,
        })
      ).json();
      await post('products/' + pid + '/content', {
        action,
        expectedVersion: cv.record?.version ?? 0,
        expectedProductVersion: cv.productVersion,
        ...(action === 'save'
          ? {
              profile: 'clothing-v2',
              slug: 'related-qa-' + suffix + '-' + i,
              description: 'Generated related-product fixture. Not real merchandise.',
              specifications: {
                material: 'Cotton',
                care: 'Gentle wash',
                fit: 'regular',
                materialGroup: 'cotton',
                occasion: 'everyday',
              },
            }
          : {}),
        ...(action === 'approve' ? { reason: 'Reviewed generated related-product content' } : {}),
      });
    }
    const pv = await (
      await fetch('http://127.0.0.1:4100/api/v1/catalog/products/' + pid + '/publication', {
        headers: h,
      })
    ).json();
    await post('products/' + pid + '/publication', {
      action: 'publish',
      expectedVersion: pv.version,
      expectedProductVersion: pv.productVersion,
      expectedContentVersion: pv.contentVersion,
      reason: 'Publish demo recommendation fixture',
    });
  }

  async function demoPost(p, b) {
    const r = await fetch('http://127.0.0.1:4100/api/v1/' + p, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json', 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify(b),
    });
    if (!r.ok) throw Error('Demo sample action failed: ' + p + ' ' + r.status);
    return r.json();
  }
  const warehouse = await demoPost('inventory/locations', {
      code: 'DEMO-WH',
      name: 'Sample central warehouse',
      kind: 'warehouse',
    }),
    store = await demoPost('inventory/locations', {
      code: 'DEMO-STORE',
      name: 'Sample Dhaka store',
      kind: 'store',
    }),
    skuRows = await db.query(
      'SELECT id,price_minor::text AS price FROM catalog_variants WHERE is_active ORDER BY sku',
    );
  await demoPost('inventory/postings', {
    kind: 'opening',
    locationId: warehouse.id,
    reason: 'Fictional opening stock for owner walkthrough only',
    reference: 'DEMO-OPENING',
    lines: skuRows.map((v, i) => ({ variantId: v.id, quantity: String(20 + i * 3) })),
  });
  await demoPost('inventory/postings', {
    kind: 'transfer',
    locationId: warehouse.id,
    destinationId: store.id,
    reason: 'Sample warehouse-to-store transfer for walkthrough',
    reference: 'DEMO-TRANSFER',
    lines: skuRows.slice(0, 4).map((v) => ({ variantId: v.id, quantity: '5' })),
  });
  for (let i = 1; i <= 3; i++)
    await demoPost('purchasing/suppliers', {
      code: 'DEMO-SUP-' + i,
      name: ['Sample cotton supplier', 'Sample garment maker', 'Sample accessories supplier'][
        i - 1
      ],
      contactName: 'Fictional contact ' + i,
      phone: '',
      email: '',
      address: 'Fictional sample address, Bangladesh',
      taxReference: '',
      notes: 'Sample record only. No real contact or financial obligation.',
      isActive: true,
    });
  for (let i = 1; i <= 3; i++)
    await demoPost('customers', {
      customerKind: 'person',
      segment: 'retail',
      name: ['Sample customer A', 'Sample customer B', 'Sample customer C'][i - 1],
      contactName: '',
      phone: '',
      email: '',
      billingAddress: null,
      deliveryAddress: null,
      notes: 'Fictional customer for local walkthrough only',
      isActive: true,
    });
  const [supplier] = await db.query("SELECT id FROM purchasing_suppliers WHERE code='DEMO-SUP-1'"),
    [customer] = await db.query("SELECT id,version FROM customers WHERE name='Sample customer A'");
  await demoPost('purchasing/orders', {
    supplierId: supplier.id,
    locationId: warehouse.id,
    expectedOn: null,
    reference: 'DEMO-PURCHASE',
    notes: 'Sample draft purchase. Issue and receive it to explore the workflow.',
    lines: skuRows
      .slice(0, 2)
      .map((v) => ({ variantId: v.id, quantity: '10', unitCost: '600.00' })),
  });
  await demoPost('sales/orders', {
    customerId: customer.id,
    customerVersion: customer.version,
    locationId: store.id,
    channel: 'retail',
    fulfillOn: null,
    reference: 'DEMO-SALE',
    notes: 'Fictional retail draft for walkthrough',
    priceReason: '',
    lines: skuRows.slice(0, 2).map((v) => ({
      variantId: v.id,
      quantity: '1',
      unitPrice:
        BigInt(v.price) / 100n + '.' + (BigInt(v.price) % 100n).toString().padStart(2, '0'),
      priceMode: 'catalog',
    })),
  });
  await writeFile(
    '.local-setup/demo-fixtures.json',
    JSON.stringify({
      version: 1,
      actorId: actor,
      productId: product,
      slug: 'gallery-qa-shirt-' + suffix,
      productIds: [product, ...relatedProducts],
      categoryIds: [category, otherCategory],
      createdAt: new Date().toISOString(),
    }),
  );
  await db.query('UPDATE staff_sessions SET revoked_at=now() WHERE staff_id=$1', [actor]);
  console.log(
    'Persistent sample products, size guide, photos and video prepared. Demo login saved locally.',
  );
} catch {
  console.error(
    'Demo preparation stopped; retained partial demo state for inspection. No business database was changed.',
  );
  process.exitCode = 1;
} finally {
  await stop();
}
