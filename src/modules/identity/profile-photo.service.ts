import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import sharp from 'sharp';
import { ImageProcessor } from '../../infrastructure/media/image-processor.js';
import { readMediaPolicy } from '../../infrastructure/media/media-policy.js';
import type { Principal } from './http.types.js';
export const PROFILE_PHOTO_POLICY = {
  ...readMediaPolicy(),
  maxUploadBytes: 5 * 1024 * 1024,
  maxPixels: 16_000_000,
  previewMaxEdge: 512,
  processingTimeoutSeconds: 10,
};
export function photoVersion(v: unknown): number {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(v) || Number(v) > 2147483646)
    throw new BadRequestException({ code: 'INVALID_PROFILE_PHOTO_VERSION' });
  return Number(v);
}
export class ProfilePhotoService {
  private receiving = 0;
  constructor(private readonly db: DataSource) {}
  async receive<T>(job: () => Promise<T>): Promise<T> {
    if (this.receiving >= 2) throw new HttpException({ code: 'PROFILE_PHOTO_BUSY' }, 429);
    this.receiving++;
    try {
      return await job();
    } finally {
      this.receiving--;
    }
  }
  private async read(user: Principal, includeImage: boolean) {
    try {
      return (
        await this.db.query('SELECT * FROM public.staff_profile_photo_read($1,$2,$3)', [
          user.id,
          user.sessionId,
          includeImage,
        ])
      )[0] as { version: number; has_photo: boolean; image: Buffer | null } | undefined;
    } catch (e) {
      this.fail(e);
    }
  }
  async metadata(user: Principal) {
    const p = await this.read(user, false);
    return { version: p?.version ?? 0, hasPhoto: p?.has_photo ?? false };
  }
  async image(user: Principal, version: number) {
    const p = await this.read(user, true);
    if (!p?.image || p.version !== version)
      throw new NotFoundException({ code: 'PROFILE_PHOTO_UNAVAILABLE' });
    return p.image;
  }
  async save(
    user: Principal,
    expected: number,
    requestId: string,
    input: Buffer | null,
    type?: string,
  ) {
    let bytes: Buffer | null = null;
    if (input) {
      try {
        const p = await new ImageProcessor(PROFILE_PHOTO_POLICY).process(input, type ?? '');
        bytes = await sharp(p.image)
          .timeout({ seconds: 10 })
          .resize(256, 256, { fit: 'cover', position: 'centre' })
          .webp({ quality: 85 })
          .toBuffer();
      } catch {
        throw new UnprocessableEntityException({ code: 'INVALID_PROFILE_PHOTO' });
      }
    }
    try {
      const [r] = await this.db.query(
        'SELECT public.staff_profile_photo_write($1,$2,$3,$4,$5) AS version',
        [user.id, user.sessionId, requestId, expected, bytes],
      );
      return { version: r.version as number, hasPhoto: bytes !== null };
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown): never {
    const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : '';
    if (message.includes('PROFILE_PHOTO_STALE'))
      throw new ConflictException({ code: 'PROFILE_PHOTO_STALE' });
    if (message.includes('PROFILE_SESSION'))
      throw new ForbiddenException({ code: 'PROFILE_SESSION' });
    throw e;
  }
}
