import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
if (process.env.PGHOST !== '127.0.0.1' || !process.env.PGPASSWORD)
  throw Error('Local administrator configuration required');
const admin = new Client({ database: 'postgres', connectionTimeoutMillis: 5000 });
let toolEnv = {};
try {
  toolEnv = parseEnv(await readFile('.env.video', 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
try {
  await admin.connect();
  for (const mode of ['dev', 'test']) {
    const file = mode === 'dev' ? '.env' : '.env.test',
      backend = parseEnv(await readFile(file, 'utf8')),
      base = new URL(backend.MIGRATION_DATABASE_URL),
      role = 'commerce_' + mode + '_video_worker',
      workerFile = mode === 'dev' ? '.env.video-worker' : '.env.video-worker.test';
    if (
      base.pathname !== '/commerce_platform_' + mode ||
      !['localhost', '127.0.0.1'].includes(base.hostname)
    )
      throw Error('Unexpected local database target');
    const roots = {
      VIDEO_QUARANTINE_DIR: path.resolve('.local-media/video-' + mode + '/quarantine'),
      VIDEO_ARTIFACT_DIR: path.resolve('.local-media/video-' + mode + '/prepared'),
      VIDEO_WORK_DIR: path.resolve('.local-setup/video-' + mode + '-work'),
    };
    let current;
    try {
      current = parseEnv(await readFile(workerFile, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const exists =
      (await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount > 0;
    if (exists && !current)
      throw Error('Existing worker role has no local connection file; refuse reset');
    let password;
    if (current) {
      const u = new URL(current.VIDEO_WORKER_DATABASE_URL);
      if (
        u.username !== role ||
        u.pathname !== base.pathname ||
        u.hostname !== base.hostname ||
        u.port !== base.port
      )
        throw Error('Worker configuration target mismatch');
      password = decodeURIComponent(u.password);
    } else {
      password = randomBytes(32).toString('hex');
      const u = new URL(base.href);
      u.username = role;
      u.password = password;
      const config = {
        NODE_ENV: mode === 'dev' ? 'development' : 'test',
        HOST: '127.0.0.1',
        VIDEO_INTAKE_MODE: 'local-development',
        VIDEO_WORKER_DATABASE_URL: u.href,
        ...roots,
        FFMPEG_PATH: toolEnv.FFMPEG_PATH ?? '/usr/bin/ffmpeg',
        FFPROBE_PATH: toolEnv.FFPROBE_PATH ?? '/usr/bin/ffprobe',
      };
      await writeFile(
        workerFile,
        Object.entries(config)
          .map(([k, v]) => k + '=' + JSON.stringify(v.replaceAll('\\', '/')))
          .join('\n') + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    }
    if (!/^[a-f0-9]{64}$/.test(password))
      throw Error('Unexpected generated worker credential format; refuse alteration');
    if (!exists)
      await admin.query(
        'CREATE ROLE "' +
          role +
          '" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ' +
          "'" +
          password +
          "'",
      );
    await admin.query(
      'GRANT CONNECT ON DATABASE "commerce_platform_' + mode + '" TO "' + role + '"',
    );
    const updates = {
      VIDEO_INTAKE_MODE: 'local-development',
      VIDEO_QUARANTINE_DIR: roots.VIDEO_QUARANTINE_DIR,
      VIDEO_ARTIFACT_DIR: roots.VIDEO_ARTIFACT_DIR,
    };
    let raw = await readFile(file, 'utf8');
    for (const [k, v] of Object.entries(updates)) {
      if (backend[k] !== undefined) {
        if (path.normalize(backend[k]) !== path.normalize(v))
          throw Error('Existing video configuration differs; refuse overwrite');
      } else raw += '\n' + k + '=' + JSON.stringify(v.replaceAll('\\', '/'));
    }
    await writeFile(file, raw + '\n', { mode: 0o600 });
  }
  console.log(
    'Restricted development/test video worker accounts configured. Existing credentials were not reset; secrets remain local.',
  );
} catch {
  console.error(
    'Video worker provisioning stopped. Preserve local connection files and inspect partial setup; secrets withheld.',
  );
  process.exitCode = 1;
} finally {
  await admin.end().catch(() => {});
}
