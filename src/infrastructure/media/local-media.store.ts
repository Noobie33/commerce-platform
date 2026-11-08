import { mkdir, open, readFile, rm, realpath, lstat } from 'node:fs/promises';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ProcessedImage } from './image-processor.js';
export type MediaSize = 'image' | 'thumbnail' | 'original';
export interface MediaStore {
  put(id: string, image: ProcessedImage): Promise<void>;
  read(id: string, size: MediaSize): Promise<Buffer>;
  openOriginal(id: string): Promise<Readable>;
  discard(id: string): Promise<void>;
}
export class LocalMediaStore implements MediaStore {
  readonly root: string;
  constructor(private readonly env: NodeJS.ProcessEnv) {
    if (env.MEDIA_STORAGE_DIR && !isAbsolute(env.MEDIA_STORAGE_DIR))
      throw Error('MEDIA_STORAGE_DIR must be an absolute directory');
    this.root = resolve(env.MEDIA_STORAGE_DIR ?? '.local-media');
  }
  private file(id: string, size: MediaSize) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid media key');
    return join(this.root, id + '-' + size + (size === 'original' ? '.bin' : '.webp'));
  }
  async put(id: string, value: ProcessedImage): Promise<void> {
    if (this.env.NODE_ENV === 'production' && !this.env.MEDIA_STORAGE_DIR)
      throw new ServiceUnavailableException('Product media storage is not configured');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink())
      throw Error('Media directory must not be a symbolic link');
    const written: string[] = [];
    try {
      for (const [size, buffer] of [
        ['image', value.image],
        ['thumbnail', value.thumbnail],
        ['original', value.original],
      ] as const) {
        const path = this.file(id, size),
          handle = await open(path, 'wx', 0o600);
        written.push(path);
        try {
          await handle.writeFile(buffer);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    } catch (error) {
      await Promise.all(written.map((path) => rm(path, { force: true })));
      throw error;
    }
  }
  private async location(id: string, size: MediaSize) {
    const root = await realpath(this.root),
      file = await realpath(this.file(id, size));
    if (dirname(file) !== root) throw Error('Invalid media location');
    return file;
  }
  async read(id: string, size: MediaSize): Promise<Buffer> {
    return readFile(await this.location(id, size));
  }
  async openOriginal(id: string): Promise<Readable> {
    const handle = await open(await this.location(id, 'original'), 'r');
    return handle.createReadStream({ autoClose: true });
  }
  async discard(id: string): Promise<void> {
    await Promise.all(
      (['image', 'thumbnail', 'original'] as const).map((size) =>
        rm(this.file(id, size), { force: true }),
      ),
    );
  }
}
