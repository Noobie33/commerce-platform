import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
const configFile = '.env.demo';
try {
  await access(configFile);
  console.log('Existing demo configuration retained; no roles or credentials changed.');
  process.exit(0);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (process.env.PGHOST !== '127.0.0.1' || !process.env.PGPASSWORD)
  throw Error('Local administrator settings required');
const db = 'commerce_platform_demo',
  roles = ['commerce_demo_migrator', 'commerce_demo_app', 'commerce_demo_video_worker'],
  passwords = roles.map(() => randomBytes(32).toString('hex')),
  admin = new Client({ database: 'postgres', connectionTimeoutMillis: 5000, query_timeout: 10000 });
try {
  await admin.connect();
  const exists = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname=$1 UNION ALL SELECT 1 FROM pg_roles WHERE rolname=ANY($2::text[])',
    [db, roles],
  );
  if (exists.rowCount) throw Error('Demo name collision; refused overwrite');
  const urls = roles.map(
      (role, i) =>
        'postgresql://' +
        role +
        ':' +
        passwords[i] +
        '@127.0.0.1:' +
        (process.env.PGPORT || '5432') +
        '/' +
        db,
    ),
    root = path.resolve('.local-media/demo'),
    tools = parseEnv(await readFile('.env.video', 'utf8'));
  const common = {
    NODE_ENV: 'development',
    DEMO_MODE: '1',
    HOST: '127.0.0.1',
    PORT: '4100',
    STAFF_ORIGIN: 'http://127.0.0.1:4100',
    DATABASE_URL: urls[1],
    MIGRATION_DATABASE_URL: urls[0],
    MEDIA_STORAGE_DIR: path.join(root, 'photos'),
    VIDEO_INTAKE_MODE: 'local-development',
    VIDEO_QUARANTINE_DIR: path.join(root, 'incoming'),
    VIDEO_ARTIFACT_DIR: path.join(root, 'prepared'),
    VIDEO_WORK_DIR: path.join(root, 'work'),
    FFMPEG_PATH: tools.FFMPEG_PATH,
    FFPROBE_PATH: tools.FFPROBE_PATH,
  };
  const encode = (o) =>
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => k + '=' + JSON.stringify(String(v).replaceAll('\\', '/')))
      .join('\n') + '\n';
  await mkdir('.local-setup', { recursive: true });
  await writeFile(configFile, encode(common), { flag: 'wx', mode: 0o600 });
  await writeFile(
    '.env.video-worker.demo',
    encode({
      ...common,
      DATABASE_URL: undefined,
      MIGRATION_DATABASE_URL: undefined,
      VIDEO_WORKER_DATABASE_URL: urls[2],
    }),
    { flag: 'wx', mode: 0o600 },
  );
  for (let i = 0; i < roles.length; i++)
    await admin.query(
      'CREATE ROLE "' +
        roles[i] +
        '" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ' +
        "'" +
        passwords[i] +
        "'",
    );
  await admin.query('CREATE DATABASE "' + db + '" OWNER "' + roles[0] + '"');
  await admin.query('REVOKE ALL ON DATABASE "' + db + '" FROM PUBLIC');
  for (const role of roles)
    await admin.query('GRANT CONNECT ON DATABASE "' + db + '" TO "' + role + '"');
  const target = new Client({ database: db, connectionTimeoutMillis: 5000 });
  try {
    await target.connect();
    await target.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await target.query('ALTER SCHEMA public OWNER TO "' + roles[0] + '"');
    for (const role of roles.slice(1))
      await target.query('GRANT USAGE ON SCHEMA public TO "' + role + '"');
  } finally {
    await target.end();
  }
  console.log(
    'Created separate local demo database and restricted logins. Secrets saved locally, not printed.',
  );
} catch {
  console.error(
    'Demo provisioning stopped. Preserve local files; no existing database or credentials were overwritten.',
  );
  process.exitCode = 1;
} finally {
  await admin.end().catch(() => {});
}
