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
        `SELECT count(*)::int AS holds,count(*) FILTER(WHERE closed_at IS NULL AND expires_at>CURRENT_TIMESTAMP)::int AS active FROM sales_reservations`,
      )
    )[0];
    const invalid = (
      await m.query(
        `SELECT count(*)::int AS n FROM sales_reservations h JOIN sales_orders o ON o.id=h.order_id LEFT JOIN(SELECT reservation_id,count(*) AS n FROM sales_reservation_lines GROUP BY reservation_id) l ON l.reservation_id=h.id WHERE l.n IS NULL OR l.n NOT BETWEEN 1 AND 30 OR h.order_version>o.version OR(h.closed_at IS NULL AND h.expires_at>CURRENT_TIMESTAMP AND(o.status<>'draft' OR h.location_id<>o.location_id OR EXISTS(SELECT 1 FROM sales_reservation_lines d LEFT JOIN sales_order_lines s ON s.order_id=o.id AND s.variant_id=d.variant_id WHERE d.reservation_id=h.id AND(s.id IS NULL OR s.quantity<>d.quantity)) OR l.n<>(SELECT count(*) FROM sales_order_lines WHERE order_id=o.id)))`,
      )
    )[0].n;
    const overbooked = (
      await m.query(
        `SELECT count(*)::int AS n FROM sales_reservation_lines d JOIN sales_reservations h ON h.id=d.reservation_id LEFT JOIN inventory_availability a ON a.location_id=h.location_id AND a.variant_id=d.variant_id WHERE h.closed_at IS NULL AND h.expires_at>CURRENT_TIMESTAMP AND(a.variant_id IS NULL OR a.available<0)`,
      )
    )[0].n;
    const revisions = (
      await m.query(
        `SELECT count(*)::int AS n FROM sales_orders o LEFT JOIN sales_reservation_state s ON s.order_id=o.id LEFT JOIN(SELECT h.order_id,count(*) AS n FROM sales_reservation_requests r JOIN sales_reservations h ON h.id=r.reservation_id GROUP BY h.order_id) q ON q.order_id=o.id WHERE coalesce(s.version,1)<>coalesce(q.n,0)+1`,
      )
    )[0].n;
    const cache = (
      await m.query(
        `SELECT count(*)::int AS n FROM sales_reservation_requests r JOIN sales_reservations h ON h.id=r.reservation_id WHERE r.response->>'id' IS DISTINCT FROM h.id::text OR r.response->>'orderId' IS DISTINCT FROM h.order_id::text OR(SELECT count(*) FROM jsonb_object_keys(r.response))<>5 OR NOT(r.response ?& ARRAY['id','orderId','revision','orderVersion','kind'])`,
      )
    )[0].n;
    return { ...counts, invalidReservations: invalid + overbooked + revisions + cache };
  });
  console.info(JSON.stringify(result));
  if (result.invalidReservations) process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
