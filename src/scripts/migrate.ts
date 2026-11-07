import { createDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
import { grantRuntime } from '../database/runtime-grants.js';

const source = createDataSource();
try {
  const name = new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname;
  if (!['/commerce_platform_dev', '/commerce_platform_test'].includes(name))
    throw new Error('Local project databases only');
  await source.initialize();
  const applied = await source.runMigrations();
  await grantRuntime(source, process.env);
  console.info('Migrations applied:', applied.length, '; restricted runtime grants verified.');
} catch {
  console.error(
    'Migration failed. Inspect local database state and configuration. No credentials logged.',
  );
  process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
