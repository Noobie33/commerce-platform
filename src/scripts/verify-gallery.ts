import { createRuntimeDataSource } from '../infrastructure/database/data-source.js';
const db = createRuntimeDataSource();
try {
  await db.initialize();
  const [r] = await db.query(
    `SELECT (SELECT count(*)::int FROM catalog_gallery_drafts) AS drafts,(SELECT count(*)::int FROM catalog_gallery_events) AS events,(SELECT count(*)::int FROM catalog_gallery_drafts d WHERE NOT EXISTS(SELECT 1 FROM catalog_gallery_events e WHERE e.product_id=d.product_id AND e.version=d.version AND e.items=d.items) OR d.version<>(SELECT count(*) FROM catalog_gallery_events e WHERE e.product_id=d.product_id)) AS "invalidHistories"`,
  );
  console.log(JSON.stringify(r));
  if (r.invalidHistories) process.exitCode = 1;
} catch {
  console.error('Gallery verification failed; private details withheld.');
  process.exitCode = 1;
} finally {
  await db.destroy().catch(() => {});
}
