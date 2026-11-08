import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
const name = new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname;
if (!['/commerce_platform_dev', '/commerce_platform_test'].includes(name))
  throw Error('Local project databases only');
const source = createRuntimeDataSource();
try {
  await source.initialize();
  const result = await source.transaction('REPEATABLE READ', async (m) => {
    const invalid = (
      await m.query(
        `SELECT count(*)::int AS total FROM purchase_orders o LEFT JOIN(SELECT order_id,count(*) AS count,sum(line_total_minor) AS total FROM purchase_order_lines GROUP BY order_id) l ON l.order_id=o.id WHERE l.count IS NULL OR o.total_minor<>l.total OR (o.issued_at IS NOT NULL AND (o.supplier_snapshot->>'id' IS DISTINCT FROM o.supplier_id::text))`,
      )
    )[0].total;
    const counts = (
      await m.query(
        'SELECT (SELECT count(*)::int FROM purchasing_suppliers) AS suppliers,(SELECT count(*)::int FROM purchase_orders) AS orders',
      )
    )[0];
    return { ...counts, invalidOrders: invalid };
  });
  console.info(JSON.stringify(result));
  if (result.invalidOrders) process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
