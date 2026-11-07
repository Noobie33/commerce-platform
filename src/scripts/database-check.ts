import { Client } from 'pg';

// Credentials are loaded by Node --env-file, never printed or embedded in code.
const required = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD'];
if (required.some((key) => !process.env[key])) {
  console.error('Administrator connection is incomplete. Fill the local .env.setup file.');
  process.exitCode = 1;
} else if (process.env.PGHOST !== '127.0.0.1') {
  console.error('Administrator check is restricted to the local server.');
  process.exitCode = 1;
} else {
  const client = new Client({ connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    const result = await client.query('SELECT current_setting($1) AS version', ['server_version']);
    console.info('Local PostgreSQL login verified. Server version:', result.rows[0]?.version);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
    console.error(
      'PostgreSQL login failed; diagnostic code:',
      /^[A-Z0-9_]+$/.test(code) ? code : 'UNKNOWN',
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
