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
const mediaRoot = await mkdtemp(join(tmpdir(), 'commerce-qa-media-'));
const app = await createApp({
  ...process.env,
  STAFF_ORIGIN: 'http://localhost:4001',
  MEDIA_STORAGE_DIR: mediaRoot,
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
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
  } finally {
    await source.destroy();
    if (
      !resolve(mediaRoot).startsWith(resolve(tmpdir()) + sep) ||
      !basename(mediaRoot).startsWith('commerce-qa-media-')
    )
      throw Error('Unsafe QA cleanup');
    await rm(mediaRoot, { recursive: true, force: true });
    process.exit(0);
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
} catch {
  await stop();
}
