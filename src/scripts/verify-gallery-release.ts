import { createRuntimeDataSource } from '../infrastructure/database/data-source.js';
const db = createRuntimeDataSource();
try {
  await db.initialize();
  const [r] = await db.query(
    `SELECT (SELECT count(*)::int FROM catalog_gallery_reviews) AS reviews,(SELECT count(*)::int FROM catalog_gallery_review_events) AS events,(SELECT count(*)::int FROM catalog_gallery_reviews r WHERE r.version<>(SELECT count(*) FROM catalog_gallery_review_events e WHERE e.product_id=r.product_id) OR NOT EXISTS(SELECT 1 FROM catalog_gallery_review_events e WHERE e.product_id=r.product_id AND e.version=r.version AND e.snapshot->>'state'=r.state AND e.snapshot->'items'=r.snapshot)) AS "invalidHistories"`,
  );
  console.log(JSON.stringify(r));
  if (r.invalidHistories) process.exitCode = 1;
} catch {
  console.error('Gallery publication verification failed; private details withheld.');
  process.exitCode = 1;
} finally {
  await db.destroy().catch(() => {});
}
