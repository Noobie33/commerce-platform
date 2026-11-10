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
    const [c] = await m.query(
      `SELECT (SELECT count(*)::int FROM catalog_category_presentation) AS prepared_categories,(SELECT count(*)::int FROM catalog_category_routes) AS reserved_names,(SELECT count(*)::int FROM catalog_product_seo WHERE title<>'' OR description<>'') AS product_seo`,
    );
    const [history] = await m.query(
      `SELECT count(*)::int AS invalid FROM catalog_category_presentation p LEFT JOIN LATERAL(SELECT count(*)::int AS n,min(version) AS first,max(version) AS last FROM catalog_category_events WHERE category_id=p.category_id) h ON true WHERE h.n<>p.version OR h.first<>1 OR h.last<>p.version`,
    );
    const [graph] = await m.query(
      `WITH RECURSIVE walk AS(SELECT id,parent_id,is_active AS origin_active,ARRAY[id] AS path,false AS cycle,1 AS depth,false AS inactive_parent FROM catalog_categories UNION ALL SELECT w.id,c.parent_id,w.origin_active,w.path||c.id,c.id=ANY(w.path),w.depth+1,w.inactive_parent OR(w.origin_active AND NOT c.is_active) FROM walk w JOIN catalog_categories c ON c.id=w.parent_id WHERE NOT w.cycle AND w.depth<=12) SELECT count(*) FILTER(WHERE cycle OR depth>12 OR inactive_parent)::int AS invalid FROM walk`,
    );
    return { ...c, invalidCategoryHistories: history.invalid, invalidGraphPaths: graph.invalid };
  });
  console.log(JSON.stringify(counts));
  if (counts.invalidCategoryHistories || counts.invalidGraphPaths) process.exitCode = 1;
} catch {
  console.error('Presentation verification failed; private details withheld.');
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
