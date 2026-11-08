import sharp from 'sharp';
import { UnprocessableEntityException } from '@nestjs/common';
sharp.cache({ memory: 32, files: 0, items: 32 });
sharp.concurrency(2);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export interface ProcessedImage {
  image: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}
export class ImageProcessor {
  async process(input: Buffer, contentType: string): Promise<ProcessedImage> {
    try {
      if (!input.length || input.length > MAX_IMAGE_BYTES) throw Error('size');
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
      const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' as const };
      const meta = await sharp(input, options).metadata();
      if (
        meta.format !== expected ||
        (meta.pages ?? 1) !== 1 ||
        !meta.width ||
        !meta.height ||
        meta.width * meta.height > MAX_IMAGE_PIXELS
      )
        throw Error('dimensions');
      const output = await sharp(input, options)
        .timeout({ seconds: 10 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      const thumbnail = await sharp(output.data, options)
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      return {
        image: output.data,
        thumbnail,
        width: output.info.width,
        height: output.info.height,
      };
    } catch {
      throw new UnprocessableEntityException({
        code: 'INVALID_PRODUCT_IMAGE',
        message:
          'Choose a valid, non-animated JPEG, PNG or WebP image up to 5 MB and 16 megapixels.',
      });
    }
  }
}
