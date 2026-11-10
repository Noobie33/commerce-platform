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
    const [n] = await m.query(
      `SELECT (SELECT count(*)::int FROM staff_access_versions) AS managed_staff,(SELECT count(*)::int FROM role_access_profiles) AS managed_roles,(SELECT count(*)::int FROM staff_access_events) AS decisions`,
    );
    const [h] = await m.query(
      `SELECT count(*)::int AS invalid FROM(SELECT 'staff' AS kind,staff_id AS id,version FROM staff_access_versions UNION ALL SELECT 'role',role_id,version FROM role_access_profiles) c LEFT JOIN LATERAL(SELECT count(*)::int AS n,min(version) AS first,max(version) AS last FROM staff_access_events e WHERE e.kind=c.kind AND e.entity_id=c.id) h ON true WHERE h.n<>c.version OR h.first<>1 OR h.last<>c.version`,
    );
    return { ...n, invalidHistories: h.invalid };
  });
  console.log(JSON.stringify(result));
  if (result.invalidHistories) process.exitCode = 1;
} catch {
  console.error('Access verification failed; private details withheld.');
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
