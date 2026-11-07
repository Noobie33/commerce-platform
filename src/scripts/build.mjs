import { spawnSync } from 'node:child_process';
import { lstat, realpath, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const output = resolve(workspace, 'dist');
if (relative(workspace, output) !== 'dist') throw new Error('Invalid build output path');
try {
  const info = await lstat(output);
  if (info.isSymbolicLink() || (await realpath(output)) !== output)
    throw new Error('Build output must be a normal workspace directory');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Only the verified absolute workspace/dist directory is removed.
await rm(output, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    resolve(workspace, 'node_modules/typescript/bin/tsc'),
    '-p',
    resolve(workspace, 'tsconfig.json'),
  ],
  { cwd: workspace, stdio: 'inherit', windowsHide: true },
);
if (result.error) throw new Error('TypeScript build could not start');
process.exitCode = result.status ?? 1;
