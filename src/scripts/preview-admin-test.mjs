import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { CatalogService } from '../../dist/src/modules/catalog/catalog.service.js';
import { productInput } from '../../dist/src/modules/catalog/catalog.validation.js';
import { AuditService } from '../../dist/src/modules/audit/audit.service.js';
import { tokenHash } from '../../dist/src/modules/identity/identity.service.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../dist/src/app.js';
import {
  createDataSource,
  databaseUrl,
} from '../../dist/src/infrastructure/database/data-source.js';
import { PasswordService } from '../../dist/src/modules/identity/password.service.js';

if (
  new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname !== '/commerce_platform_test'
)
  throw new Error('Dedicated test database only');
const source = createDataSource();
await source.initialize();
const id = randomUUID();
const username = 'ui_preview_' + randomBytes(4).toString('hex');
const password = 'Disposable UI preview password 2026!';
const hash = await new PasswordService().hash(password);
await source.transaction(async (manager) => {
  await manager.query(
    'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES ($1,$2,$3,$4,false)',
    [id, username, 'Preview Staff', hash],
  );
  await manager.query(
    "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
    [id],
  );
});
const qaLocations = [];
const mediaRoot = await mkdtemp(join(tmpdir(), 'commerce-qa-media-'));
const app = await createApp({
  ...process.env,
  STAFF_ORIGIN: 'http://localhost:4001',
  MEDIA_STORAGE_DIR: mediaRoot,
});
let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  let cleaned = false;
  try {
    await app.close();
    await source.transaction(async (manager) => {
      const products = await manager.query(
        'SELECT resource_id FROM catalog_requests WHERE actor_id=$1',
        [id],
      );
      const productIds = products.map((row) => row.resource_id);
      const createdCategories = await manager.query(
        "SELECT metadata->>'entityId' AS id FROM audit_events WHERE actor_id=$1 AND action='catalog.category_created'",
        [id],
      );
      const createdLocations = await manager.query(
        "SELECT metadata->>'locationId' AS id FROM audit_events WHERE actor_id=$1 AND action='inventory.location_created'",
        [id],
      );
      for (const row of createdLocations)
        if (!qaLocations.includes(row.id)) qaLocations.push(row.id);
      await manager.query('DELETE FROM inventory_requests WHERE actor_id=$1', [id]);
      await manager.query('DELETE FROM inventory_entries WHERE location_id=ANY($1::uuid[])', [
        qaLocations,
      ]);
      await manager.query('DELETE FROM inventory_balances WHERE location_id=ANY($1::uuid[])', [
        qaLocations,
      ]);
      await manager.query('DELETE FROM inventory_postings WHERE actor_id=$1', [id]);
      await manager.query('DELETE FROM locations WHERE id=ANY($1::uuid[])', [qaLocations]);
      await manager.query('DELETE FROM catalog_media_requests WHERE product_id=ANY($1::uuid[])', [
        productIds,
      ]);
      await manager.query('DELETE FROM catalog_product_photos WHERE product_id=ANY($1::uuid[])', [
        productIds,
      ]);
      await manager.query('DELETE FROM catalog_requests WHERE actor_id=$1', [id]);
      await manager.query('DELETE FROM catalog_variants WHERE product_id=ANY($1::uuid[])', [
        productIds,
      ]);
      await manager.query('DELETE FROM catalog_products WHERE id=ANY($1::uuid[])', [productIds]);
      await manager.query('DELETE FROM catalog_categories WHERE id=ANY($1::uuid[])', [
        createdCategories.map((row) => row.id),
      ]);
      await manager.query('DELETE FROM audit_events WHERE actor_id=$1', [id]);
      await manager.query('DELETE FROM staff_sessions WHERE staff_id=$1', [id]);
      await manager.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [id]);
      await manager.query('DELETE FROM staff_users WHERE id=$1', [id]);
      await manager.query('DELETE FROM login_rate_limits WHERE bucket_hash=$1', [
        tokenHash('user:' + username),
      ]);
      // Shared IP rate limits remain untouched.
    });
    cleaned = true;
  } finally {
    await source.destroy();
    if (
      !resolve(mediaRoot).startsWith(resolve(tmpdir()) + sep) ||
      !basename(mediaRoot).startsWith('commerce-qa-media-')
    )
      throw Error('Unsafe QA cleanup');
    await rm(mediaRoot, { recursive: true, force: true });
    process.exit(cleaned ? exitCode : 1);
  }
}
try {
  if (process.argv.includes('--catalog')) {
    const catalog = new CatalogService(source, new AuditService());
    const category = await catalog.createCategory(
      {
        name: 'Preview essentials ' + username.slice(-8),
        nameKey: 'preview-essentials-' + username,
        parentId: null,
      },
      id,
      randomUUID(),
    );
    const names = [
      'Essential cotton tee',
      'Relaxed linen shirt',
      'Everyday hoodie',
      'Straight-leg trousers',
      'Textured overshirt',
      'Everyday canvas tote',
    ];
    for (const [index, name] of names.entries()) {
      const styleCode = 'QA-' + username.slice(-8).toUpperCase() + '-' + (index + 1);
      await catalog.save(
        productInput(
          {
            styleCode,
            name,
            description:
              'Disposable preview product. Fabric and care details can be added to the product description.',
            categoryId: category.id,
            status: index === 3 ? 'draft' : index === 5 ? 'archived' : 'active',
            currency: 'BDT',
            variants: [
              {
                sku: styleCode + '-M',
                attributes: { size: 'M', colour: 'Black' },
                barcode: null,
                price: String(1250 + index * 150) + '.00',
                isActive: true,
              },
              {
                sku: styleCode + '-L',
                attributes: { size: 'L', colour: 'Ivory' },
                barcode: null,
                price: String(1250 + index * 150) + '.00',
                isActive: true,
              },
            ],
          },
          false,
        ),
        null,
        id,
        randomUUID(),
        randomUUID(),
      );
    }
  }
  if (process.argv.includes('--inventory')) {
    for (const [index, name] of ['QA central warehouse', 'QA retail store'].entries()) {
      const rows = await source.query(
        'INSERT INTO locations(code,name,kind) VALUES($1,$2,$3) RETURNING id',
        [
          'QA-' + username.slice(-8).toUpperCase() + '-' + index,
          name,
          index ? 'store' : 'warehouse',
        ],
      );
      qaLocations.push(rows[0].id);
    }
  }
  await app.listen(4001, '127.0.0.1');
  console.info('Disposable UI QA ready: http://localhost:4001/admin; username=' + username);
  console.info(
    'stdin controls: ready (simulate completed onboarding), stop (close and remove fixture).',
  );
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    const command = String(chunk).trim();
    if (command === 'ready') {
      await source.query('UPDATE staff_users SET must_change_password=false WHERE id=$1', [id]);
      console.info('Disposable fixture onboarding state updated.');
    }
    if (command === 'stop') await stop();
  });
  process.stdin.resume();
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
} catch (error) {
  console.error(
    'Disposable QA setup failed:',
    error instanceof Error ? error.message : 'Unknown failure',
  );
  await stop(1);
}
