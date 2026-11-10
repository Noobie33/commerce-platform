import { mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
export function contained(root: string, file: string): boolean {
  const r = relative(root, file);
  return !!r && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r);
}
export async function privateVideoRoot(input: string): Promise<string> {
  if (!isAbsolute(input)) throw Error('Private video directory must be absolute');
  const root = resolve(input);
  // Existing and foreseeable web-source/output trees must never hold private originals.
  for (const webRoot of ['dist/public', 'apps/admin', 'apps/storefront', 'public']) {
    const web = resolve(webRoot);
    if (root === web || contained(web, root))
      throw Error('Video workspace must be outside web assets');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw Error('Private video directory cannot be a link');
  const actual = await realpath(root);
  if (process.platform === 'win32' ? actual.toLowerCase() !== root.toLowerCase() : actual !== root)
    throw Error('Private video directory cannot redirect through links');
  return actual;
}
