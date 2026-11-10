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
    const [n] = await m.query(
      `SELECT count(*) FILTER(WHERE state='pending' AND expires_at>clock_timestamp())::int AS pending,count(*) FILTER(WHERE state='pending' AND expires_at<=clock_timestamp())::int AS expired,count(*) FILTER(WHERE state='accepted')::int AS activated,count(*) FILTER(WHERE state='revoked')::int AS revoked FROM staff_onboarding`,
    );
    const [h] = await m.query(
      `SELECT count(*)::int AS invalid FROM staff_onboarding o LEFT JOIN LATERAL(SELECT count(*)::int AS n,min(version) AS first,max(version) AS last FROM staff_onboarding_events e WHERE e.staff_id=o.staff_id) h ON true WHERE h.n<>o.version OR h.first<>1 OR h.last<>o.version`,
    );
    const [a] = await m.query(
      `SELECT count(*)::int AS invalid FROM staff_onboarding o JOIN staff_users u ON u.id=o.staff_id WHERE(o.state IN('pending','revoked') AND(u.password_hash<>'!pending-enrollment' OR NOT u.must_change_password)) OR(o.state='pending' AND NOT u.is_active)`,
    );
    return { ...n, invalidHistories: h.invalid, invalidPendingAccounts: a.invalid };
  });
  console.log(JSON.stringify(counts));
  if (counts.invalidHistories || counts.invalidPendingAccounts) process.exitCode = 1;
} catch {
  console.error('Onboarding verification failed; private details withheld.');
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
