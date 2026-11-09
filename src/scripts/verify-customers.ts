import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
if (
  !['/commerce_platform_dev', '/commerce_platform_test'].includes(
    new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname,
  )
)
  throw Error('Local project databases only');
const source = createRuntimeDataSource();
try {
  await source.initialize();
  const result = await source.transaction('REPEATABLE READ', async (m) => {
    const counts = (
      await m.query(
        `SELECT count(*)::int AS customers,count(*) FILTER(WHERE is_active)::int AS active,count(*) FILTER(WHERE credit_enabled)::int AS credit_enabled FROM customers`,
      )
    )[0];
    const invalid = (
      await m.query(
        `SELECT count(*)::int AS n FROM customers c LEFT JOIN LATERAL(SELECT current_policy,version FROM customer_credit_history WHERE customer_id=c.id ORDER BY version DESC LIMIT 1) h ON true WHERE (h.version IS NOT NULL AND(h.version>c.version OR h.current_policy<>jsonb_build_object('creditEnabled',c.credit_enabled,'creditLimitMinor',c.credit_limit_minor::text,'paymentTermsDays',c.payment_terms_days))) OR(h.version IS NULL AND c.credit_enabled) OR c.code !~ '^CUST-[0-9]{8,}$' OR (c.phone<>'' AND c.phone !~ '^\\+[1-9][0-9]{7,14}$')`,
      )
    )[0].n;
    const cache = (
      await m.query(
        `SELECT count(*)::int AS n FROM customer_requests r JOIN customers c ON c.id=r.customer_id WHERE r.response->>'id'<>c.id::text OR (SELECT count(*) FROM jsonb_object_keys(r.response))<>3 OR NOT(r.response ?& ARRAY['id','version','kind'])`,
      )
    )[0].n;
    return { ...counts, invalidCustomers: invalid + cache };
  });
  console.info(JSON.stringify(result));
  if (result.invalidCustomers) process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
