import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { runMediaProcess, MediaProcessError } from './bounded-media-process.js';
import { readVideoPolicy, readVideoTools } from './video-policy.js';
import type { VideoPolicy, VideoTools } from './video-policy.js';
import { parseVideoMetadata } from './video-metadata.js';
import type { VideoMetadata } from './video-metadata.js';
import { contained, privateVideoRoot } from './video-workspace.js';
export interface PreparedVideo {
  original: Buffer;
  playback: Buffer;
  poster: Buffer;
  originalType: 'video/mp4' | 'video/quicktime';
  source: VideoMetadata;
  playbackMetadata: VideoMetadata;
  posterWidth: number;
  posterHeight: number;
  originalHash: string;
  playbackHash: string;
  posterHash: string;
}
export const videoHash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const probeEntries =
  'format=format_name,duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,channels,sample_rate,duration,nb_frames,sample_aspect_ratio,color_transfer,color_primaries:stream_disposition=attached_pic:stream_side_data=rotation';
let activeJobs = 0;
export class VideoProcessor {
  constructor(
    readonly tools: VideoTools = readVideoTools(process.env),
    readonly policy: VideoPolicy = readVideoPolicy(process.env),
  ) {}
  private async probe(file: string, bytes: number, signal?: AbortSignal) {
    const output = await runMediaProcess(
      this.tools.ffprobe,
      [
        '-v',
        'error',
        '-threads',
        '2',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mov',
        '-enable_drefs',
        '0',
        '-use_absolute_path',
        '0',
        '-show_entries',
        probeEntries,
        '-of',
        'json',
        file,
      ],
      this.policy.probeTimeoutMs,
      262144,
      signal,
    );
    return parseVideoMetadata(JSON.parse(output), this.policy, bytes);
  }
  async process(input: Buffer, type: string, signal?: AbortSignal): Promise<PreparedVideo> {
    const invalid = () =>
      new UnprocessableEntityException({
        code: 'INVALID_PRODUCT_VIDEO',
        message: 'Choose a supported SDR MP4/MOV product clip within the configured limits.',
      });
    if (
      !Buffer.isBuffer(input) ||
      input.length < 32 ||
      input.length > this.policy.maxSourceBytes ||
      !['video/mp4', 'video/quicktime'].includes(type) ||
      input.toString('ascii', 4, 8) !== 'ftyp' ||
      input.readUInt32BE(0) < 16 ||
      input.readUInt32BE(0) > input.length
    )
      throw invalid();
    if ((input.toString('ascii', 8, 12) === 'qt  ') !== (type === 'video/quicktime'))
      throw invalid();
    if (activeJobs >= 1)
      throw new ServiceUnavailableException({
        code: 'VIDEO_BUSY',
        message: 'Video processing is busy. Please retry.',
      });
    activeJobs++;
    let dir: string | undefined, root: string | undefined;
    const original = Buffer.from(input),
      originalHash = videoHash(original);
    try {
      root = await privateVideoRoot(this.tools.workRoot);
      dir = await mkdtemp(join(root, 'job-'));
      const file = join(dir, 'source.bin'),
        playbackFile = join(dir, 'playback.mp4'),
        posterFile = join(dir, 'poster.webp');
      await writeFile(file, original, { flag: 'wx', mode: 0o600 });
      const source = await this.probe(file, original.length, signal);
      const fps = Math.min(source.fps, this.policy.maxPlaybackFps).toFixed(6),
        edge = this.policy.maxPlaybackEdge;
      await runMediaProcess(
        this.tools.ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-n',
          '-filter_threads',
          '2',
          '-filter_complex_threads',
          '2',
          '-protocol_whitelist',
          'file',
          '-format_whitelist',
          'mov',
          '-enable_drefs',
          '0',
          '-use_absolute_path',
          '0',
          '-threads',
          '2',
          '-i',
          file,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-sn',
          '-dn',
          '-map_metadata',
          '-1',
          '-map_metadata:s:v',
          '-1',
          '-map_metadata:s:a',
          '-1',
          '-map_chapters',
          '-1',
          '-vf',
          "scale=w='min(iw," +
            edge +
            ")':h='min(ih," +
            edge +
            ")':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
          '-r',
          fps,
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          '20',
          '-maxrate',
          '8M',
          '-bufsize',
          '16M',
          '-pix_fmt',
          'yuv420p',
          '-threads',
          '2',
          '-metadata:s:v:0',
          'rotate=0',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ac',
          '2',
          '-ar',
          '48000',
          '-movflags',
          '+faststart',
          '-t',
          String(this.policy.maxDurationSeconds + 1),
          '-fs',
          String(this.policy.maxPlaybackBytes),
          playbackFile,
        ],
        this.policy.processingTimeoutMs,
        262144,
        signal,
      );
      const playbackBytes = (await stat(playbackFile)).size;
      if (playbackBytes > this.policy.maxPlaybackBytes) throw invalid();
      const output = await this.probe(playbackFile, playbackBytes, signal);
      if (
        output.videoCodec !== 'h264' ||
        (output.hasAudio && output.audioCodec !== 'aac') ||
        output.hasAudio !== source.hasAudio ||
        output.pixelFormat !== 'yuv420p' ||
        output.rotation !== 0 ||
        output.width % 2 ||
        output.height % 2 ||
        Math.max(output.width, output.height) > edge ||
        output.width > source.displayWidth ||
        output.height > source.displayHeight ||
        output.fps > this.policy.maxPlaybackFps + 0.001 ||
        Math.abs(output.durationSeconds - source.durationSeconds) > Math.max(0.25, 3 / Number(fps))
      )
        throw invalid();
      await runMediaProcess(
        this.tools.ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-n',
          '-filter_threads',
          '2',
          '-filter_complex_threads',
          '2',
          '-protocol_whitelist',
          'file',
          '-format_whitelist',
          'mov',
          '-ss',
          String(Math.min(1, output.durationSeconds / 2)),
          '-threads',
          '2',
          '-i',
          playbackFile,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          "scale=w='min(iw,640)':h='min(ih,640)':force_original_aspect_ratio=decrease",
          '-c:v',
          'libwebp',
          '-quality',
          '85',
          '-threads',
          '2',
          '-an',
          '-sn',
          '-dn',
          '-map_metadata',
          '-1',
          '-update',
          '1',
          posterFile,
        ],
        this.policy.probeTimeoutMs,
        262144,
        signal,
      );
      if ((await stat(posterFile)).size > this.policy.maxPosterBytes) throw invalid();
      const poster = await readFile(posterFile),
        meta = await sharp(poster, { limitInputPixels: 640 * 640 }).metadata();
      if (
        meta.format !== 'webp' ||
        !meta.width ||
        !meta.height ||
        meta.width > 640 ||
        meta.height > 640 ||
        meta.exif ||
        meta.xmp
      )
        throw invalid();
      if (videoHash(await readFile(file)) !== originalHash) throw invalid();
      const playback = await readFile(playbackFile);
      return {
        original,
        originalType: type as PreparedVideo['originalType'],
        source,
        playbackMetadata: output,
        playback,
        poster,
        posterWidth: meta.width,
        posterHeight: meta.height,
        originalHash,
        playbackHash: videoHash(playback),
        posterHash: videoHash(poster),
      };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof UnprocessableEntityException
      )
        throw error;
      if (error instanceof MediaProcessError && error.reason === 'start')
        throw new ServiceUnavailableException({
          code: 'VIDEO_TOOLS_UNAVAILABLE',
          message: 'Video processing tools are unavailable.',
        });
      throw invalid();
    } finally {
      try {
        if (dir && root) {
          if (!contained(root, dir)) throw Error('Unsafe video cleanup target');
          await rm(dir, { recursive: true, force: true });
        }
      } finally {
        activeJobs--;
      }
    }
  }
}
