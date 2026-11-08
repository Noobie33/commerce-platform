import { createRuntimeDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
const name = new URL(databaseUrl(process.env, 'DATABASE_URL')).pathname;
if (!['/commerce_platform_dev', '/commerce_platform_test'].includes(name))
  throw Error('Local project databases only');
const source = createRuntimeDataSource();
try {
  await source.initialize();
  const result = await source.transaction('REPEATABLE READ', async (m) => {
    const balances = (
      await m.query(
        `SELECT count(*)::int AS total FROM (SELECT location_id,variant_id FROM inventory_balances FULL JOIN (SELECT location_id,variant_id,sum(delta) AS ledger FROM inventory_entries GROUP BY location_id,variant_id) e USING(location_id,variant_id) WHERE quantity IS NULL OR ledger IS NULL OR quantity<>ledger) mismatch`,
      )
    )[0].total as number;
    const postings = (
      await m.query(
        `SELECT count(*)::int AS total FROM inventory_postings p WHERE NOT EXISTS(SELECT 1 FROM inventory_entries e WHERE e.posting_id=p.id) OR ((p.kind='transfer' OR (p.kind='reversal' AND p.destination_id IS NOT NULL)) AND EXISTS(SELECT 1 FROM inventory_entries e WHERE e.posting_id=p.id GROUP BY variant_id HAVING sum(delta)<>0 OR count(*)<>2))`,
      )
    )[0].total as number;
    const counts = (
      await m.query(
        'SELECT (SELECT count(*)::int FROM inventory_postings) AS postings,(SELECT count(*)::int FROM inventory_entries) AS entries,(SELECT count(*)::int FROM inventory_balances) AS balances',
      )
    )[0];
    return { ...counts, balanceMismatches: balances, invalidPostings: postings };
  });
  console.info(JSON.stringify(result));
  if (result.balanceMismatches || result.invalidPostings) process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
