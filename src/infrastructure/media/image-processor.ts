import { readMediaPolicy } from './media-policy.js';
import type { MediaPolicy } from './media-policy.js';
import sharp from 'sharp';
import { UnprocessableEntityException } from '@nestjs/common';
sharp.cache({ memory: 32, files: 0, items: 32 });
sharp.concurrency(2);
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 64_000_000;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export interface ProcessedImage {
  image: Buffer;
  original: Buffer;
  originalType: string;
  originalWidth: number;
  originalHeight: number;
  thumbnail: Buffer;
  width: number;
  height: number;
}
function animatedContainer(input: Buffer, format: 'png' | 'webp'): boolean {
  let offset = format === 'png' ? 8 : 12;
  while (offset + (format === 'png' ? 12 : 8) <= input.length) {
    const length = format === 'png' ? input.readUInt32BE(offset) : input.readUInt32LE(offset + 4);
    const kind = input.toString(
      'ascii',
      offset + (format === 'png' ? 4 : 0),
      offset + (format === 'png' ? 8 : 4),
    );
    if (
      (format === 'png' && kind === 'acTL') ||
      (format === 'webp' && ['ANIM', 'ANMF'].includes(kind))
    )
      return true;
    const next =
      offset + (format === 'png' ? 12 : 8) + length + (format === 'webp' ? length % 2 : 0);
    if (next > input.length) throw Error('Invalid image container');
    offset = next;
    if (format === 'png' && kind === 'IEND') break;
  }
  return false;
}
export class ImageProcessor {
  constructor(readonly policy: MediaPolicy = readMediaPolicy()) {}
  async process(input: Buffer, contentType: string): Promise<ProcessedImage> {
    try {
      if (!input.length || input.length > this.policy.maxUploadBytes) throw Error('size');
      const expected =
        contentType === 'image/jpeg'
          ? 'jpeg'
          : contentType === 'image/png'
            ? 'png'
            : contentType === 'image/webp'
              ? 'webp'
              : '';
      const signature = input.subarray(0, 12);
      const detected = signature.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        ? 'jpeg'
        : signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? 'png'
          : signature.subarray(0, 4).toString() === 'RIFF' &&
              signature.subarray(8, 12).toString() === 'WEBP'
            ? 'webp'
            : '';
      if (!expected || expected !== detected) throw Error('format');
      if ((detected === 'png' || detected === 'webp') && animatedContainer(input, detected))
        throw Error('animation');
      const options = { limitInputPixels: this.policy.maxPixels, failOn: 'warning' as const };
      const meta = await sharp(input, options).metadata();
      if (
        meta.format !== expected ||
        (meta.pages ?? 1) !== 1 ||
        !meta.width ||
        !meta.height ||
        meta.width * meta.height > this.policy.maxPixels
      )
        throw Error('dimensions');
      const output = await sharp(input, options)
        .timeout({ seconds: this.policy.processingTimeoutSeconds })
        .rotate()
        .resize({
          width: this.policy.previewMaxEdge,
          height: this.policy.previewMaxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer({ resolveWithObject: true });
      const thumbnail = await sharp(output.data, options)
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      return {
        image: output.data,
        original: input,
        originalType: contentType,
        originalWidth: meta.width,
        originalHeight: meta.height,
        thumbnail,
        width: output.info.width,
        height: output.info.height,
      };
    } catch {
      throw new UnprocessableEntityException({
        code: 'INVALID_PRODUCT_IMAGE',
        message:
          'Choose a valid, non-animated JPEG, PNG or WebP within the displayed size and pixel limits.',
      });
    }
  }
}
