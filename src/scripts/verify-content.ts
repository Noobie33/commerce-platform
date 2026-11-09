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
    const [counts] = await m.query(
      `SELECT count(*)::int AS content_records,count(*) FILTER(WHERE state='in_review')::int AS in_review,count(*) FILTER(WHERE state='approved')::int AS approved,count(*) FILTER(WHERE state IN('in_review','approved') AND fingerprint IS DISTINCT FROM encode(sha256(convert_to(public.catalog_content_snapshot(product_id)::text,'UTF8')),'hex'))::int AS stale_review_copies FROM catalog_product_content`,
    );
    const [records] = await m.query(
      `SELECT count(*)::int AS n FROM catalog_product_content c LEFT JOIN LATERAL(SELECT version,state,snapshot FROM catalog_content_events WHERE product_id=c.product_id ORDER BY version DESC LIMIT 1) e ON true WHERE (c.submitted_snapshot IS NULL) IS DISTINCT FROM (c.fingerprint IS NULL) OR(c.state IN('in_review','approved') AND c.submitted_by IS NULL) OR e.version IS DISTINCT FROM c.version OR e.state IS DISTINCT FROM c.state OR e.snapshot->>'profile' IS DISTINCT FROM c.profile_code OR e.snapshot->>'slug' IS DISTINCT FROM c.slug OR e.snapshot->>'description' IS DISTINCT FROM c.description OR e.snapshot->'specifications' IS DISTINCT FROM c.specifications OR (SELECT count(*) FROM catalog_content_events WHERE product_id=c.product_id)<>c.version OR(c.submitted_snapshot IS NOT NULL AND c.fingerprint<>encode(sha256(convert_to(c.submitted_snapshot::text,'UTF8')),'hex'))`,
    );
    const [history] = await m.query(
      `SELECT count(*)::int AS n FROM catalog_content_events WHERE fingerprint<>encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')`,
    );
    const [cache] = await m.query(
      `SELECT count(*)::int AS n FROM catalog_content_requests r JOIN catalog_product_content c ON c.product_id=r.product_id WHERE (SELECT count(*) FROM jsonb_object_keys(r.response))<>3 OR NOT(r.response ?& ARRAY['productId','version','state']) OR r.response->>'productId'<>r.product_id::text OR(r.response->>'version')::integer NOT BETWEEN 1 AND c.version OR r.response->>'state' NOT IN('draft','in_review','approved','changes_requested')`,
    );
    return { ...counts, invalidContentRecords: records.n + history.n + cache.n };
  });
  console.log(JSON.stringify(result));
  if (result.invalidContentRecords) process.exitCode = 1;
} catch {
  console.error(
    'Product content verification failed. Private content and credentials are withheld.',
  );
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
