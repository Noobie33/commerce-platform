import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
const name = new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname;
if (!['/commerce_platform_dev', '/commerce_platform_test'].includes(name))
  throw Error('Local project databases only');
const source = createRuntimeDataSource();
try {
  await source.initialize();
  const result = await source.transaction('REPEATABLE READ', async (m) => {
    const invalidHeaders = (
      await m.query(
        `SELECT count(*)::int AS n FROM supplier_invoices i JOIN purchase_orders o ON o.id=i.order_id LEFT JOIN(SELECT invoice_id,count(*) AS n,sum(line_total_minor) AS total FROM supplier_invoice_lines GROUP BY invoice_id) l ON l.invoice_id=i.id WHERE l.n IS NULL OR l.total<>i.goods_minor OR i.supplier_id<>o.supplier_id OR i.supplier_snapshot IS DISTINCT FROM o.supplier_snapshot OR (i.reversed_at IS NULL AND o.status<>'issued')`,
      )
    )[0].n;
    const invalidLinks = (
      await m.query(
        `SELECT count(*)::int AS n FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.id=l.invoice_id JOIN purchase_receipts r ON r.id=l.receipt_id WHERE r.order_id<>i.order_id OR (i.reversed_at IS NULL AND EXISTS(SELECT 1 FROM purchase_receipt_reversals x WHERE x.receipt_id=r.id))`,
      )
    )[0].n;
    const overAllocated = (
      await m.query(
        `SELECT count(*)::int AS n FROM purchase_receipt_lines r JOIN(SELECT l.receipt_id,l.order_line_id,sum(l.quantity) AS quantity FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.id=l.invoice_id WHERE i.reversed_at IS NULL GROUP BY l.receipt_id,l.order_line_id) b ON b.receipt_id=r.receipt_id AND b.order_line_id=r.order_line_id WHERE b.quantity>r.quantity`,
      )
    )[0].n;
    const invalidRevisions = (
      await m.query(
        `SELECT count(*)::int AS n FROM purchase_orders o LEFT JOIN supplier_invoice_state s ON s.order_id=o.id LEFT JOIN(SELECT order_id,count(*)+count(reversed_at) AS events FROM supplier_invoices GROUP BY order_id) a ON a.order_id=o.id WHERE coalesce(s.version,1)<>coalesce(a.events,0)+1`,
      )
    )[0].n;
    const counts = (
      await m.query(
        `SELECT count(*)::int AS invoices,count(*) FILTER(WHERE i.reversed_at IS NULL)::int AS active,coalesce(sum(b.remaining_minor) FILTER(WHERE i.reversed_at IS NULL),0)::text AS unsettledMinor FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id`,
      )
    )[0];
    return {
      ...counts,
      invalidInvoices: invalidHeaders + invalidLinks + overAllocated + invalidRevisions,
    };
  });
  console.info(JSON.stringify(result));
  if (result.invalidInvoices) process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
