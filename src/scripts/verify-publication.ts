import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
if (
  !['/commerce_platform_dev', '/commerce_platform_test'].includes(
    new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname,
  )
)
  throw Error('Local project databases only');
const db = createRuntimeDataSource();
try {
  await db.initialize();
  const counts = await db.transaction('REPEATABLE READ', async (m) => {
    const [r] = await m.query(
      `SELECT (SELECT count(*)::int FROM catalog_media_reviews) AS reviewed_photos,(SELECT count(*)::int FROM catalog_releases WHERE state='published') AS recorded_published,(SELECT count(*)::int FROM catalog_releases WHERE state='published' AND coalesce(public.catalog_release_eligible(product_id),false)) AS currently_available`,
    );
    const [h] = await m.query(
      `SELECT count(*)::int AS invalid FROM(SELECT 'release' AS kind,product_id AS id,version FROM catalog_releases UNION ALL SELECT 'media',photo_id,version FROM catalog_media_reviews) c LEFT JOIN LATERAL(SELECT count(*)::int AS n,min(version) AS first,max(version) AS last FROM catalog_publication_events e WHERE e.kind=c.kind AND e.entity_id=c.id) h ON true WHERE h.n<>c.version OR h.first<>1 OR h.last<>c.version`,
    );
    return { ...r, invalidHistories: h.invalid };
  });
  console.log(JSON.stringify(counts));
  if (counts.invalidHistories) process.exitCode = 1;
} catch {
  console.error('Publication verification failed; private details withheld.');
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
