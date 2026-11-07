import { execFileSync } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function restrictWindows(path: string, directory: boolean): void {
  const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const sid = identity.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error('Cannot determine local owner');
  const rights = directory ? '(OI)(CI)F' : '(F)';
  execFileSync(
    'icacls.exe',
    [
      path,
      '/inheritance:r',
      '/grant:r',
      '*' + sid + ':' + rights,
      '*S-1-5-18:' + (directory ? '(OI)(CI)F' : '(F)'),
    ],
    { stdio: 'ignore', windowsHide: true },
  );
}

export async function writePrivateFile(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') restrictWindows(directory, true);
  await writeFile(path, content, { flag: 'wx', mode: 0o600 });
  try {
    if (process.platform === 'win32') restrictWindows(path, false);
  } catch (error) {
    // Only this newly created file is removed; existing files are never overwritten.
    await unlink(path);
    throw error;
  }
}
