import { mkdir, open, rename, rm, readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  BadRequestException,
  PayloadTooLargeException,
  RequestTimeoutException,
} from '@nestjs/common';
import type { StaffRequest, StaffResponse } from '../../modules/identity/http.types.js';
import { privateVideoRoot, contained } from './video-workspace.js';
import { videoHash } from './video-processor.js';
export async function syncVideoDirectory(dir: string) {
  if (process.platform === 'win32') return;
  const h = await open(dir, 'r');
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
export async function syncVideoFile(file: string) {
  const h = await open(file, 'r+');
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
export function localVideoEnabled(env: NodeJS.ProcessEnv) {
  return (
    env.VIDEO_INTAKE_MODE === 'local-development' &&
    env.NODE_ENV !== 'production' &&
    ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(env.HOST ?? '127.0.0.1')
  );
}
export class VideoIntakeStore {
  constructor(readonly root: string) {}
  private key(id: string) {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
      throw Error('Invalid video source key');
    return id;
  }
  async receive(req: StaffRequest, res: StaffResponse, maxBytes: number) {
    const length = req.headers['content-length'];
    if (!length || !/^\d{1,9}$/.test(length) || Number(length) < 32)
      throw new BadRequestException({ code: 'VIDEO_INVALID' });
    if (Number(length) > maxBytes) throw new PayloadTooLargeException({ code: 'VIDEO_TOO_LARGE' });
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
      throw new BadRequestException({ code: 'VIDEO_INVALID' });
    const root = await privateVideoRoot(this.root),
      id = randomUUID(),
      dir = join(root, id);
    await mkdir(dir, { mode: 0o700 });
    const file = join(dir, 'source.part'),
      hash = createHash('sha256');
    let bytes = 0,
      timedOut = false,
      head = Buffer.alloc(0);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 60000);
    timer.unref();
    try {
      await pipeline(
        req,
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            if (bytes > maxBytes || bytes > Number(length))
              return done(new PayloadTooLargeException({ code: 'VIDEO_TOO_LARGE' }));
            hash.update(chunk);
            if (head.length < 32) head = Buffer.concat([head, chunk.subarray(0, 32 - head.length)]);
            done(null, chunk);
          },
        }),
        createWriteStream(file, { flags: 'wx', mode: 0o600 }),
        { signal: abort.signal },
      );
      if (bytes !== Number(length) || head.toString('ascii', 4, 8) !== 'ftyp')
        throw new BadRequestException({ code: 'VIDEO_INVALID' });
      await syncVideoFile(file);
      await rename(file, join(dir, 'source.bin'));
      await syncVideoDirectory(dir);
      await syncVideoDirectory(root);
      return { id, bytes, hash: hash.digest('hex') };
    } catch (e) {
      res.setHeader('Connection', 'close');
      if (!contained(root, dir)) throw Error('Unsafe source cleanup target');
      await rm(dir, { recursive: true, force: true });
      if (timedOut) throw new RequestTimeoutException({ code: 'VIDEO_UPLOAD_TIMEOUT' });
      if (e instanceof PayloadTooLargeException || e instanceof BadRequestException) throw e;
      throw new BadRequestException({ code: 'VIDEO_UPLOAD_INCOMPLETE' });
    } finally {
      clearTimeout(timer);
    }
  }
  async read(id: string, expectedHash: string, maxBytes = 209715200) {
    const root = await privateVideoRoot(this.root),
      file = join(root, this.key(id), 'source.bin');
    if ((await lstat(file)).isSymbolicLink() || dirname(await realpath(file)) !== join(root, id))
      throw Error('Invalid video source location');
    const h = await open(file, 'r');
    try {
      if ((await h.stat()).size > maxBytes) throw Error('Source exceeds limit');
      const b = await h.readFile();
      if (videoHash(b) !== expectedHash) throw Error('Source integrity failed');
      return b;
    } finally {
      await h.close();
    }
  }
  async discard(id: string) {
    const root = await privateVideoRoot(this.root),
      dir = join(root, this.key(id));
    if (!contained(root, dir)) throw Error('Unsafe source cleanup target');
    await rm(dir, { recursive: true, force: true });
  }
  async ids() {
    const root = await privateVideoRoot(this.root);
    return (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && /^[a-f0-9-]{36}$/.test(d.name))
      .map((d) => d.name);
  }
}
export async function readPreparedVideo(
  rootInput: string,
  id: string,
  size: 'playback' | 'poster' | 'original',
  expected: string,
  maxBytes: number,
) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
    throw Error('Invalid artifact key');
  const root = await privateVideoRoot(rootInput),
    dir = join(root, id),
    file = join(
      dir,
      size === 'playback' ? 'playback.mp4' : size === 'poster' ? 'poster.webp' : 'original.bin',
    );
  if (
    (await lstat(dir)).isSymbolicLink() ||
    (await lstat(file)).isSymbolicLink() ||
    dirname(await realpath(file)) !== dir
  )
    throw Error('Invalid prepared location');
  const h = await open(file, 'r');
  try {
    if ((await h.stat()).size > maxBytes) throw Error('Prepared size exceeds limit');
    const b = await h.readFile();
    if (videoHash(b) !== expected) throw Error('Prepared integrity mismatch');
    return b;
  } finally {
    await h.close();
  }
}
