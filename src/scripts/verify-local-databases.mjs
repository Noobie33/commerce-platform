import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { Client } from 'pg';

for (const [mode, file] of [
  ['dev', '.env'],
  ['test', '.env.test'],
]) {
  const env = parseEnv(await readFile(file, 'utf8'));
  const expectedDb = 'commerce_platform_' + mode;
  for (const [key, expectedRole] of [
    ['DATABASE_URL', 'commerce_' + mode + '_app'],
    ['MIGRATION_DATABASE_URL', 'commerce_' + mode + '_migrator'],
  ]) {
    const url = new URL(env[key]);
    assert.equal(url.pathname, '/' + expectedDb);
    assert.equal(url.username, expectedRole);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    const client = new Client({
      connectionString: url.href,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    try {
      await client.connect();
      const {
        rows: [role],
      } = await client.query(
        'SELECT current_database() AS database, current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      assert.equal(role.database, expectedDb);
      assert.equal(role.name, expectedRole);
      for (const flag of [
        'rolsuper',
        'rolcreatedb',
        'rolcreaterole',
        'rolreplication',
        'rolbypassrls',
      ])
        assert.equal(role[flag], false);
      const {
        rows: [schema],
      } = await client.query(
        "SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create",
      );
      assert.equal(schema.can_create, key === 'MIGRATION_DATABASE_URL');
    } finally {
      await client.end().catch(() => undefined);
    }
    const other = new URL(url);
    other.pathname = '/commerce_platform_' + (mode === 'dev' ? 'test' : 'dev');
    const foreign = new Client({ connectionString: other.href, connectionTimeoutMillis: 5000 });
    try {
      await assert.rejects(foreign.connect(), { code: '42501' });
    } finally {
      await foreign.end().catch(() => undefined);
    }
  }
  console.info(
    expectedDb + ': runtime/migrator login, restricted roles and cross-database denial verified.',
  );
}
