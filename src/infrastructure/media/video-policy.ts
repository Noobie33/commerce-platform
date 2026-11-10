import { isAbsolute } from 'node:path';
export interface VideoPolicy {
  maxSourceBytes: number;
  maxDurationSeconds: number;
  maxSourcePixels: number;
  maxSourceEdge: number;
  maxSourceFps: number;
  maxPlaybackEdge: number;
  maxPlaybackFps: number;
  maxPlaybackBytes: number;
  maxPosterBytes: number;
  probeTimeoutMs: number;
  processingTimeoutMs: number;
}
export interface VideoTools {
  ffmpeg: string;
  ffprobe: string;
  workRoot: string;
  artifactRoot: string;
}
export function readVideoPolicy(env: NodeJS.ProcessEnv = {}): VideoPolicy {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    if (
      !/^[1-9][0-9]*$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) < min ||
      Number(raw) > max
    )
      throw Error('Invalid ' + key);
    return Number(raw);
  };
  return {
    maxSourceBytes: integer('VIDEO_MAX_UPLOAD_MB', 100, 1, 200) * 1024 * 1024,
    maxDurationSeconds: integer('VIDEO_MAX_DURATION_SECONDS', 120, 1, 300),
    maxSourcePixels: 16777216,
    maxSourceEdge: 4096,
    maxSourceFps: 120,
    maxPlaybackEdge: 1920,
    maxPlaybackFps: 30,
    maxPlaybackBytes: 80 * 1024 * 1024,
    maxPosterBytes: 1024 * 1024,
    probeTimeoutMs: 10000,
    processingTimeoutMs: 90000,
  };
}
export function readVideoTools(env: NodeJS.ProcessEnv): VideoTools {
  const value = (key: string) => {
    const v = env[key];
    if (!v || !isAbsolute(v) || /[\u0000-\u001f]/u.test(v))
      throw Error('Configure an absolute ' + key);
    return v;
  };
  return {
    ffmpeg: value('FFMPEG_PATH'),
    ffprobe: value('FFPROBE_PATH'),
    workRoot: value('VIDEO_WORK_DIR'),
    artifactRoot: value('VIDEO_ARTIFACT_DIR'),
  };
}
