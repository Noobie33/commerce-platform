import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

function git(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('Git safety check failed');
  return result.stdout;
}
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const denied = files.filter(
  (path) => /(^|\/)\.local-setup(\/|$)|(^|\/)\.env(?:\.|$)/.test(path) && path !== '.env.example',
);
if (denied.length)
  throw new Error('Private setup/credential artifact is tracked; refusing publication');

const sensitive = new Set();
const assignments = new Set();
for (const file of [
  '.env',
  '.env.test',
  '.env.setup',
  '.env.video-worker',
  '.env.video-worker.test',
]) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const env = parseEnv(raw);
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (key.endsWith('_URL')) {
      try {
        const url = new URL(value);
        if (url.password) {
          sensitive.add(value);
          sensitive.add(decodeURIComponent(url.password));
        }
      } catch {}
    }
    if (/PASSWORD|SECRET|TOKEN/.test(key)) {
      if (value.length >= 16) sensitive.add(value);
      assignments.add(key + '=' + value);
      assignments.add(key + '="' + value + '"');
    }
  }
}
try {
  const owner = JSON.parse(await readFile('.local-setup/owner-access.json', 'utf8'));
  if (typeof owner.password === 'string' && owner.password.length >= 16)
    sensitive.add(owner.password);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const patterns = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
function check(text, label) {
  if (
    patterns.some((pattern) => pattern.test(text)) ||
    [...sensitive, ...assignments].some((value) => text.includes(value))
  ) {
    throw new Error('Potential credential exposure in ' + label + '; refusing publication');
  }
}
for (const path of files) check(await readFile(path, 'utf8'), path);
// Inspect committed blobs as well, so removing a secret from the current tree cannot hide history.
const objects = git(['rev-list', '--objects', '--all']).split(/\r?\n/).filter(Boolean);
let scanned = 0;
for (const line of objects) {
  const id = line.split(' ')[0];
  if (git(['cat-file', '-t', id]).trim() !== 'blob') continue;
  check(git(['cat-file', 'blob', id]), 'committed history blob');
  scanned++;
}
console.info(
  'Secret safety check passed: ' +
    files.length +
    ' tracked files and ' +
    scanned +
    ' history blobs. Private artifacts remain excluded.',
);
