import { runMediaProcess } from '../infrastructure/media/bounded-media-process.js';
import { readVideoTools, readVideoPolicy } from '../infrastructure/media/video-policy.js';
try {
  const t = readVideoTools(process.env),
    p = readVideoPolicy(process.env);
  const ffmpeg = await runMediaProcess(t.ffmpeg, ['-version'], p.probeTimeoutMs),
    ffprobe = await runMediaProcess(t.ffprobe, ['-version'], p.probeTimeoutMs);
  const encoders = await runMediaProcess(t.ffmpeg, ['-hide_banner', '-encoders'], p.probeTimeoutMs);
  if (
    !/ffmpeg version /.test(ffmpeg) ||
    !/ffprobe version /.test(ffprobe) ||
    !['libx264', 'libwebp', 'aac'].every((x) => new RegExp('\\b' + x + '\\b').test(encoders))
  )
    throw Error('Required tools or encoders unavailable');
  console.log(
    JSON.stringify({
      ffmpeg: ffmpeg.split(/\r?\n/)[0],
      ffprobe: ffprobe.split(/\r?\n/)[0],
      encoders: ['libx264', 'libwebp', 'aac'],
      maxSourceMB: p.maxSourceBytes / 1024 / 1024,
      maxDurationSeconds: p.maxDurationSeconds,
    }),
  );
} catch {
  console.error(
    'Video tools verification failed. Configure the private video environment and required encoders.',
  );
  process.exitCode = 1;
}
