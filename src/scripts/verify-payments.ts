import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
const name = new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname;
if (!['/commerce_platform_dev', '/commerce_platform_test'].includes(name))
  throw Error('Local project databases only');
const source = createRuntimeDataSource();
try {
  await source.initialize();
  const result = await source.transaction('REPEATABLE READ', async (m) => {
    const headers = (
      await m.query(
        `SELECT count(*)::int AS n FROM supplier_payments p LEFT JOIN(SELECT payment_id,count(*) AS n,sum(amount_minor) AS total FROM supplier_payment_allocations GROUP BY payment_id) a ON a.payment_id=p.id WHERE a.n IS NULL OR a.n NOT BETWEEN 1 AND 25 OR a.total<>p.amount_minor OR p.paid_on>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date`,
      )
    )[0].n;
    const links = (
      await m.query(
        `SELECT count(*)::int AS n FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id JOIN supplier_invoices i ON i.id=a.invoice_id WHERE p.supplier_id<>i.supplier_id OR p.paid_on<i.invoice_on OR (p.reversed_at IS NULL AND i.reversed_at IS NOT NULL)`,
      )
    )[0].n;
    const overpaid = (
      await m.query(
        `SELECT count(*)::int AS n FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id WHERE b.paid_minor<0 OR b.paid_minor>i.total_minor OR b.remaining_minor<0 OR (i.reversed_at IS NOT NULL AND b.paid_minor<>0)`,
      )
    )[0].n;
    const revisions = (
      await m.query(
        `SELECT count(*)::int AS n FROM purchasing_suppliers s LEFT JOIN supplier_payment_state v ON v.supplier_id=s.id LEFT JOIN(SELECT supplier_id,count(*)+count(reversed_at) AS events FROM supplier_payments GROUP BY supplier_id) a ON a.supplier_id=s.id WHERE coalesce(v.version,1)<>coalesce(a.events,0)+1`,
      )
    )[0].n;
    const counts = (
      await m.query(
        `SELECT count(*)::int AS payments,count(*) FILTER(WHERE reversed_at IS NULL)::int AS active,coalesce(sum(amount_minor) FILTER(WHERE reversed_at IS NULL),0)::text AS "recordedMinor" FROM supplier_payments`,
      )
    )[0];
    return { ...counts, invalidPayments: headers + links + overpaid + revisions };
  });
  console.info(JSON.stringify(result));
  if (result.invalidPayments) process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
