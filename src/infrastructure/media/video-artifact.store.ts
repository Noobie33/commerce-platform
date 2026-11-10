import { mkdir, writeFile, readFile, rm, lstat, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { privateVideoRoot, contained } from './video-workspace.js';
import { videoHash } from './video-processor.js';
import type { PreparedVideo } from './video-processor.js';
export class VideoArtifactStore {
  constructor(private readonly configuredRoot: string) {}
  async put(id: string, video: PreparedVideo): Promise<string> {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
      throw Error('Invalid video artifact key');
    const root = await privateVideoRoot(this.configuredRoot),
      dir = join(root, id);
    await mkdir(dir, { mode: 0o700 }); // Exclusive: never overwrite an existing prepared bundle.
    try {
      for (const [name, bytes, expected] of [
        ['original.bin', video.original, video.originalHash],
        ['playback.mp4', video.playback, video.playbackHash],
        ['poster.webp', video.poster, video.posterHash],
      ] as const) {
        if (videoHash(bytes) !== expected) throw Error('Prepared video integrity mismatch');
        const file = join(dir, name);
        await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
        if (
          (await lstat(file)).isSymbolicLink() ||
          dirname(await realpath(file)) !== dir ||
          videoHash(await readFile(file)) !== expected
        )
          throw Error('Prepared video integrity mismatch');
      }
      const manifest = {
        version: 1,
        state: 'prepared_private',
        originalType: video.originalType,
        source: video.source,
        playback: video.playbackMetadata,
        poster: { width: video.posterWidth, height: video.posterHeight },
        bytes: {
          original: video.original.length,
          playback: video.playback.length,
          poster: video.poster.length,
        },
        hashes: {
          original: video.originalHash,
          playback: video.playbackHash,
          poster: video.posterHash,
        },
      };
      // A manifest is written last. This is a private handoff artifact, not database-backed durable publication.
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      return dir;
    } catch (e) {
      if (!contained(root, dir)) throw Error('Unsafe artifact cleanup target');
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
  }
}
