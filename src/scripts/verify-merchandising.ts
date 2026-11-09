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
    const [row] = await m.query(
      `SELECT count(*) FILTER(WHERE kind='size_guide')::int AS size_guides,count(*) FILTER(WHERE kind='collection')::int AS collections FROM catalog_merch_items`,
    );
    const [history] = await m.query(
      `SELECT count(*)::int AS invalid FROM catalog_merch_items h LEFT JOIN LATERAL(SELECT count(*)::int AS n,min(version) AS first,max(version) AS last FROM catalog_merch_versions WHERE item_id=h.id) v ON true WHERE v.n<>h.version OR v.first<>1 OR v.last<>h.version`,
    );
    const [links] = await m.query('SELECT count(*)::int AS assignments FROM catalog_merch_links');
    return { ...row, ...links, invalidVersionHistories: history.invalid };
  });
  console.info(JSON.stringify(counts));
  if (counts.invalidVersionHistories) process.exitCode = 1;
} catch {
  console.error('Merchandising verification failed; private details withheld.');
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
