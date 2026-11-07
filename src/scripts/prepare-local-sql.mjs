import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const folder = resolve('.local-setup');
for (const file of ['.env', '.env.test', '.local-setup']) {
  try {
    await access(file);
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  throw new Error('Existing setup file/folder: refusing to overwrite');
}
const plans = ['dev', 'test'].map((mode) => ({
  mode,
  db: 'commerce_platform_' + mode,
  owner: 'commerce_' + mode + '_migrator',
  runtime: 'commerce_' + mode + '_app',
  ownerPassword: randomBytes(32).toString('hex'),
  runtimePassword: randomBytes(32).toString('hex'),
}));
const allRoles = plans.flatMap((p) => [p.owner, p.runtime]);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const roles = [
  '-- Private setup: contains generated credentials. Do not share or commit.',
  '-- Open on the postgres database using the saved administrator connection.',
  'BEGIN;',
  'DO $$ BEGIN',
  'IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN (' +
    plans.map((p) => quote(p.db)).join(',') +
    ')) OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (' +
    allRoles.map(quote).join(',') +
    ")) THEN RAISE EXCEPTION 'Existing commerce database/role: stop and inspect'; END IF;",
  'END; $$;',
  ...plans.flatMap((p) =>
    [
      [p.owner, p.ownerPassword],
      [p.runtime, p.runtimePassword],
    ].map(
      ([role, password]) =>
        'CREATE ROLE "' +
        role +
        '" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ' +
        quote(password) +
        ';',
    ),
  ),
  'COMMIT;',
].join('\n');
await mkdir(folder, { mode: 0o700 });
const save = (file, text) => writeFile(file, text + '\n', { flag: 'wx', mode: 0o600 });
await save(resolve(folder, '01_roles.sql'), roles);
for (const [index, p] of plans.entries()) {
  const url = (user, password) =>
    'postgresql://' + user + ':' + password + '@localhost:5432/' + p.db;
  await save(
    p.mode === 'dev' ? '.env' : '.env.test',
    'NODE_ENV=' +
      (p.mode === 'test' ? 'test' : 'development') +
      '\nDATABASE_URL=' +
      url(p.runtime, p.runtimePassword) +
      '\nMIGRATION_DATABASE_URL=' +
      url(p.owner, p.ownerPassword),
  );
  await save(
    resolve(folder, '0' + (index + 2) + '_' + p.mode + '_database.sql'),
    '-- Run this file alone, with Auto-commit enabled; CREATE DATABASE cannot run inside BEGIN.\n' +
      'CREATE DATABASE "' +
      p.db +
      '" OWNER "' +
      p.owner +
      '" TEMPLATE template0 ENCODING ' +
      quote('UTF8') +
      ';',
  );
}
await save(
  resolve(folder, '04_access.sql'),
  plans
    .map(
      (p) =>
        'REVOKE ALL ON DATABASE "' +
        p.db +
        '" FROM PUBLIC;\n' +
        'GRANT CONNECT ON DATABASE "' +
        p.db +
        '" TO "' +
        p.runtime +
        '";',
    )
    .join('\n'),
);
console.info(
  'Four private SQL files and local connection files prepared. No database connection or SQL execution performed.',
);
