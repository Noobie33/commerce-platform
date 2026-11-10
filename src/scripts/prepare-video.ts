import { readFile, stat, lstat } from 'node:fs/promises';
import { isAbsolute, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VideoProcessor } from '../infrastructure/media/video-processor.js';
import { VideoArtifactStore } from '../infrastructure/media/video-artifact.store.js';
import { readVideoTools, readVideoPolicy } from '../infrastructure/media/video-policy.js';
try {
  const input = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !input ||
    !isAbsolute(input) ||
    !['.mp4', '.mov'].includes(extname(input).toLowerCase())
  )
    throw Error('Provide one absolute MP4/MOV input path');
  const tools = readVideoTools(process.env),
    policy = readVideoPolicy(process.env),
    info = await lstat(input);
  if (!info.isFile() || info.isSymbolicLink() || info.size > policy.maxSourceBytes)
    throw Error('Invalid local input');
  const buffer = await readFile(input);
  if ((await stat(input)).size !== buffer.length) throw Error('Input changed while reading');
  const video = await new VideoProcessor(tools, policy).process(
    buffer,
    extname(input).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4',
  );
  const id = randomUUID(),
    directory = await new VideoArtifactStore(tools.artifactRoot).put(id, video);
  console.log(
    JSON.stringify({
      id,
      directory,
      state: 'prepared_private',
      durationSeconds: video.playbackMetadata.durationSeconds,
      width: video.playbackMetadata.width,
      height: video.playbackMetadata.height,
      originalUnchanged: true,
    }),
  );
} catch {
  console.error(
    'Video preparation failed. Check the local tools, supported SDR format and configured limits. No product was uploaded or published.',
  );
  process.exitCode = 1;
}
