import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';

const host = process.env.PGHOST;
if (host !== '127.0.0.1' || !process.env.PGPASSWORD)
  throw new Error('Local administrator configuration required');
const admin = new Client({ connectionTimeoutMillis: 5000, query_timeout: 10000 });
const plans = ['dev', 'test'].map((mode) => ({
  mode,
  db: 'commerce_platform_' + mode,
  owner: 'commerce_' + mode + '_migrator',
  runtime: 'commerce_' + mode + '_app',
  ownerPassword: randomBytes(32).toString('hex'),
  runtimePassword: randomBytes(32).toString('hex'),
  file: mode === 'dev' ? '.env' : '.env.test',
}));
let mutationStarted = false;
try {
  await admin.connect();
  for (const p of plans) {
    const collision = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1 UNION ALL SELECT 1 FROM pg_roles WHERE rolname = ANY($2::text[])',
      [p.db, [p.owner, p.runtime]],
    );
    if (collision.rowCount) throw new Error('Existing database or role name; refuse overwrite');
    let exists = true;
    try {
      await access(p.file);
    } catch (error) {
      if (error.code === 'ENOENT') exists = false;
      else throw error;
    }
    if (exists) throw new Error('Existing local connection file; refuse overwrite');
  }
  // Persist generated credentials before SQL changes, so partial failures remain recoverable.
  for (const p of plans) {
    const url = (user, password) =>
      'postgresql://' +
      user +
      ':' +
      password +
      '@127.0.0.1:' +
      (process.env.PGPORT || '5432') +
      '/' +
      p.db;
    await writeFile(
      p.file,
      'NODE_ENV=' +
        (p.mode === 'test' ? 'test' : 'development') +
        '\nDATABASE_URL=' +
        url(p.runtime, p.runtimePassword) +
        '\nMIGRATION_DATABASE_URL=' +
        url(p.owner, p.ownerPassword) +
        '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  mutationStarted = true;
  // Identifiers are fixed in this script; passwords are generated hex, never user-supplied SQL.
  for (const p of plans) {
    for (const [role, password] of [
      [p.owner, p.ownerPassword],
      [p.runtime, p.runtimePassword],
    ]) {
      await admin.query(
        'CREATE ROLE "' +
          role +
          '" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ' +
          "'" +
          password +
          "'",
      );
    }
    await admin.query('CREATE DATABASE "' + p.db + '" OWNER "' + p.owner + '"');
    await admin.query('REVOKE ALL ON DATABASE "' + p.db + '" FROM PUBLIC');
    await admin.query('GRANT CONNECT ON DATABASE "' + p.db + '" TO "' + p.runtime + '"');
    const target = new Client({
      database: p.db,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    try {
      await target.connect();
      await target.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await target.query('ALTER SCHEMA public OWNER TO "' + p.owner + '"');
      await target.query('GRANT USAGE ON SCHEMA public TO "' + p.runtime + '"');
    } finally {
      await target.end();
    }
  }
  console.info(
    'Created isolated development/test databases and restricted roles. Local connection files saved; secrets not printed.',
  );
} catch {
  console.error(
    mutationStarted
      ? 'Provisioning interrupted after SQL changes. Preserve local connection files; inspect partial state before retrying. Nothing was automatically dropped.'
      : 'Provisioning refused or connection failed. Check local configuration and name/file conflicts; credentials not printed.',
  );
  process.exitCode = 1;
} finally {
  await admin.end().catch(() => undefined);
}
