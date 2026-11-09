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
  const result = await db.transaction('REPEATABLE READ', async (m) => {
    const counts = (
      await m.query(
        `SELECT count(*)::int AS orders,count(*) FILTER(WHERE status='draft')::int AS drafts,count(*) FILTER(WHERE status='cancelled')::int AS cancelled FROM sales_orders`,
      )
    )[0];
    const invalid = (
      await m.query(
        `SELECT count(*)::int AS n FROM sales_orders o LEFT JOIN(SELECT order_id,count(*) AS n,sum(line_total_minor) AS total,bool_or(price_mode='override') AS overridden FROM sales_order_lines GROUP BY order_id) l ON l.order_id=o.id WHERE l.n IS NULL OR l.n NOT BETWEEN 1 AND 30 OR o.total_minor<>l.total OR(l.overridden AND length(btrim(o.price_reason))=0) OR o.number !~ '^SO-[0-9]{10,}$' OR o.customer_snapshot->>'id' IS DISTINCT FROM o.customer_id::text`,
      )
    )[0].n;
    const cache = (
      await m.query(
        `SELECT count(*)::int AS n FROM sales_requests r JOIN sales_orders o ON o.id=r.order_id WHERE r.response->>'id' IS DISTINCT FROM o.id::text OR(SELECT count(*) FROM jsonb_object_keys(r.response))<>3 OR NOT(r.response ?& ARRAY['id','version','kind'])`,
      )
    )[0].n;
    return { ...counts, invalidSalesDrafts: invalid + cache };
  });
  console.info(JSON.stringify(result));
  if (result.invalidSalesDrafts) process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
