import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
if (
  !['/commerce_platform_dev', '/commerce_platform_test'].includes(
    new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname,
  )
)
  throw Error('Local project database required');
const db = createRuntimeDataSource();
try {
  await db.initialize();
  const [counts] = await db.query(
    `SELECT count(*)::int AS total,count(*) FILTER(WHERE state='queued')::int AS queued,count(*) FILTER(WHERE state='processing')::int AS processing,count(*) FILTER(WHERE state='ready')::int AS ready,count(*) FILTER(WHERE state='failed')::int AS failed,count(*) FILTER(WHERE state='processing' AND lease_until<=clock_timestamp())::int AS expired_leases FROM catalog_product_videos`,
  );
  const [bad] = await db.query(
    `SELECT count(*)::int AS n FROM catalog_product_videos v LEFT JOIN LATERAL(SELECT version,snapshot FROM catalog_video_events WHERE video_id=v.id ORDER BY version DESC LIMIT 1)e ON true WHERE e.version IS DISTINCT FROM v.version OR e.snapshot->>'state' IS DISTINCT FROM v.state OR e.snapshot->>'reviewState' IS DISTINCT FROM v.review_state OR (SELECT count(*) FROM catalog_video_events WHERE video_id=v.id)<>v.version`,
  );
  console.log(JSON.stringify({ ...counts, invalidHistories: bad.n }));
  if (bad.n) process.exitCode = 1;
} catch {
  console.error('Private video verification failed. Credentials and media details withheld.');
  process.exitCode = 1;
} finally {
  await db.destroy().catch(() => {});
}
