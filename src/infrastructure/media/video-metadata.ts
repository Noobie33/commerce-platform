import type { VideoPolicy } from './video-policy.js';
export interface VideoMetadata {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  durationSeconds: number;
  fps: number;
  rotation: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string | null;
  pixelFormat: string;
}
type Row = Record<string, unknown>;
const row = (v: unknown): Row => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid video metadata');
  return v as Row;
};
function number(v: unknown): number {
  if (typeof v === 'string' && !/^[0-9]+(?:\.[0-9]+)?$/.test(v))
    throw Error('Invalid numeric metadata');
  if (typeof v !== 'number' && typeof v !== 'string') throw Error('Missing numeric metadata');
  const n = Number(v);
  if (!Number.isFinite(n)) throw Error('Invalid numeric metadata');
  return n;
}
function rate(v: unknown): number | null {
  if (v === undefined || v === '0/0') return null;
  if (typeof v !== 'string' || !/^\d+\/\d+$/.test(v)) throw Error('Invalid frame rate');
  const [a, b] = v.split('/').map(Number);
  if (!b) return null;
  return a! / b;
}
export function parseVideoMetadata(
  value: unknown,
  policy: VideoPolicy,
  bytes: number,
): VideoMetadata {
  const r = row(value),
    format = row(r.format);
  if (
    typeof format.format_name !== 'string' ||
    !format.format_name.split(',').includes('mov') ||
    number(format.size) !== bytes
  )
    throw Error('Unsupported container');
  if (!Array.isArray(r.streams) || r.streams.length < 1 || r.streams.length > 2)
    throw Error('Unsupported stream layout');
  const streams = r.streams.map(row),
    videos = streams.filter((s) => s.codec_type === 'video'),
    audios = streams.filter((s) => s.codec_type === 'audio');
  if (videos.length !== 1 || audios.length > 1 || videos.length + audios.length !== streams.length)
    throw Error('Unsupported stream layout');
  const v = videos[0]!,
    a = audios[0];
  if (
    !['h264', 'hevc', 'av1', 'mpeg4', 'vp9'].includes(String(v.codec_name)) ||
    Number(row(v.disposition ?? {}).attached_pic ?? 0) !== 0
  )
    throw Error('Unsupported video codec');
  if (
    a &&
    (!['aac', 'mp3', 'alac', 'pcm_s16le', 'pcm_s24le', 'opus'].includes(String(a.codec_name)) ||
      number(a.channels) < 1 ||
      number(a.channels) > 8 ||
      number(a.sample_rate) < 8000 ||
      number(a.sample_rate) > 192000)
  )
    throw Error('Unsupported audio');
  const width = number(v.width),
    height = number(v.height),
    durationSeconds = number(format.duration),
    fps = rate(v.avg_frame_rate) ?? rate(v.r_frame_rate),
    peakFps = rate(v.r_frame_rate);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    Math.max(width, height) > policy.maxSourceEdge ||
    width * height > policy.maxSourcePixels ||
    durationSeconds < 0.1 ||
    durationSeconds > policy.maxDurationSeconds ||
    !fps ||
    fps <= 0 ||
    fps > policy.maxSourceFps ||
    (peakFps !== null && peakFps > policy.maxSourceFps)
  )
    throw Error('Video exceeds processing limits');
  if (
    v.duration !== undefined &&
    v.duration !== 'N/A' &&
    Math.abs(number(v.duration) - durationSeconds) > 0.5
  )
    throw Error('Inconsistent stream duration');
  if (
    v.nb_frames !== undefined &&
    v.nb_frames !== 'N/A' &&
    number(v.nb_frames) > policy.maxDurationSeconds * policy.maxSourceFps + 2
  )
    throw Error('Frame count exceeds limit');
  if (
    v.sample_aspect_ratio !== undefined &&
    !['1:1', 'N/A'].includes(String(v.sample_aspect_ratio))
  )
    throw Error('Non-square pixels require separate handling');
  const transfer = String(v.color_transfer ?? 'unknown');
  if (
    !['unknown', 'unspecified', 'bt709'].includes(transfer) ||
    !['unknown', 'unspecified', 'bt709'].includes(String(v.color_primaries ?? 'unknown'))
  )
    throw Error('Color conversion requires a separate validated pipeline');
  if (
    ['smpte2084', 'arib-std-b67'].includes(transfer) ||
    !['yuv420p', 'yuvj420p', 'yuv422p', 'yuv444p', 'nv12'].includes(String(v.pix_fmt))
  )
    throw Error('HDR or high-bit-depth video requires separate processing');
  const side = Array.isArray(v.side_data_list) ? v.side_data_list.map(row) : [];
  if (side.filter((x) => x.rotation !== undefined).length > 1) throw Error('Ambiguous rotation');
  const raw = side.find((x) => x.rotation !== undefined)?.rotation ?? 0;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw % 90) > 0.001)
    throw Error('Unsupported rotation');
  const rotation = ((Math.round(raw) % 360) + 360) % 360;
  return {
    width,
    height,
    displayWidth: rotation % 180 ? height : width,
    displayHeight: rotation % 180 ? width : height,
    durationSeconds,
    fps,
    rotation,
    hasAudio: !!a,
    videoCodec: String(v.codec_name),
    audioCodec: a ? String(a.codec_name) : null,
    pixelFormat: String(v.pix_fmt),
  };
}
