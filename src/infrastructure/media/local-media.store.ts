import { mkdir, writeFile, readFile, rm, realpath, lstat } from 'node:fs/promises';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ProcessedImage } from './image-processor.js';
export interface MediaStore {
  put(id: string, image: ProcessedImage): Promise<void>;
  read(id: string, size: 'image' | 'thumbnail'): Promise<Buffer>;
  discard(id: string): Promise<void>;
}
export class LocalMediaStore implements MediaStore {
  readonly root: string;
  constructor(private readonly env: NodeJS.ProcessEnv) {
    if (env.MEDIA_STORAGE_DIR && !isAbsolute(env.MEDIA_STORAGE_DIR))
      throw Error('MEDIA_STORAGE_DIR must be an absolute directory');
    this.root = resolve(env.MEDIA_STORAGE_DIR ?? '.local-media');
  }
  private file(id: string, size: 'image' | 'thumbnail') {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid media key');
    return join(this.root, id + '-' + size + '.webp');
  }
  async put(id: string, value: ProcessedImage): Promise<void> {
    if (this.env.NODE_ENV === 'production' && !this.env.MEDIA_STORAGE_DIR)
      throw new ServiceUnavailableException('Product media storage is not configured');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink())
      throw Error('Media directory must not be a symbolic link');
    let fullWritten = false;
    try {
      await writeFile(this.file(id, 'image'), value.image, { flag: 'wx', mode: 0o600 });
      fullWritten = true;
      await writeFile(this.file(id, 'thumbnail'), value.thumbnail, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (fullWritten) await rm(this.file(id, 'image'), { force: true });
      throw error;
    }
  }
  async read(id: string, size: 'image' | 'thumbnail'): Promise<Buffer> {
    const root = await realpath(this.root),
      file = await realpath(this.file(id, size));
    if (dirname(file) !== root) throw Error('Invalid media location');
    return readFile(file);
  }
  async discard(id: string): Promise<void> {
    await Promise.all([
      rm(this.file(id, 'image'), { force: true }),
      rm(this.file(id, 'thumbnail'), { force: true }),
    ]);
  }
}
