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
    const headerErrors = (
      await m.query(
        "SELECT count(*)::int AS n FROM purchase_receipts r JOIN purchase_orders o ON o.id=r.order_id JOIN inventory_postings p ON p.id=r.inventory_posting_id WHERE r.location_id<>o.location_id OR p.location_id<>r.location_id OR p.kind<>'receipt' OR p.destination_id IS NOT NULL OR p.actor_id<>r.actor_id OR (o.status='cancelled' AND NOT EXISTS(SELECT 1 FROM purchase_receipt_reversals x WHERE x.receipt_id=r.id)) OR NOT EXISTS(SELECT 1 FROM purchase_receipt_lines l WHERE l.receipt_id=r.id)",
      )
    )[0].n;
    const lineErrors = (
      await m.query(
        'SELECT count(*)::int AS n FROM (SELECT r.inventory_posting_id AS posting_id,r.location_id,l.variant_id,x.quantity FROM purchase_receipt_lines x JOIN purchase_receipts r ON r.id=x.receipt_id JOIN purchase_order_lines l ON l.id=x.order_line_id) expected FULL JOIN (SELECT e.posting_id,e.location_id,e.variant_id,e.delta FROM inventory_entries e JOIN purchase_receipts r ON r.inventory_posting_id=e.posting_id) actual USING(posting_id,location_id,variant_id) WHERE expected.quantity IS NULL OR actual.delta IS NULL OR expected.quantity<>actual.delta',
      )
    )[0].n;
    const overReceived = (
      await m.query(
        'SELECT count(*)::int AS n FROM purchase_order_lines l JOIN(SELECT x.order_line_id,sum(x.quantity) AS quantity FROM purchase_receipt_lines x WHERE NOT EXISTS(SELECT 1 FROM purchase_receipt_reversals r WHERE r.receipt_id=x.receipt_id) GROUP BY x.order_line_id) t ON t.order_line_id=l.id WHERE t.quantity>l.quantity',
      )
    )[0].n;
    const reversalErrors = (
      await m.query(
        "SELECT count(*)::int AS n FROM purchase_receipt_reversals x JOIN purchase_receipts r ON r.id=x.receipt_id JOIN inventory_postings p ON p.id=x.inventory_posting_id WHERE p.kind<>'reversal' OR p.reversal_of IS DISTINCT FROM r.inventory_posting_id OR p.actor_id<>x.actor_id",
      )
    )[0].n;
    const unlinkedReversals = (
      await m.query(
        'SELECT count(*)::int AS n FROM purchase_receipts r JOIN inventory_postings p ON p.reversal_of=r.inventory_posting_id LEFT JOIN purchase_receipt_reversals x ON x.inventory_posting_id=p.id WHERE x.receipt_id IS DISTINCT FROM r.id',
      )
    )[0].n;
    const stateErrors = (
      await m.query(
        'SELECT count(*)::int AS n FROM purchase_orders o LEFT JOIN purchase_receipt_state s ON s.order_id=o.id LEFT JOIN(SELECT order_id,count(*) AS events FROM(SELECT order_id FROM purchase_receipts UNION ALL SELECT r.order_id FROM purchase_receipt_reversals x JOIN purchase_receipts r ON r.id=x.receipt_id) actions GROUP BY order_id) a ON a.order_id=o.id WHERE coalesce(s.version,1)<>coalesce(a.events,0)+1',
      )
    )[0].n;
    const receiptCounts = (
      await m.query(
        'SELECT (SELECT count(*)::int FROM purchase_receipts) AS receipts,(SELECT count(*)::int FROM purchase_receipt_reversals) AS reversals',
      )
    )[0];
    return {
      ...counts,
      ...receiptCounts,
      invalidOrders: invalid,
      invalidReceipts:
        headerErrors + lineErrors + overReceived + reversalErrors + unlinkedReversals + stateErrors,
    };
  });
  console.info(JSON.stringify(result));
  if (result.invalidOrders || result.invalidReceipts) process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
