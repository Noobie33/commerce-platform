import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { Authenticated, ImageUpload } from '../authorization/route-policy.js';
import { readImageBody } from '../../infrastructure/media/read-image-body.js';
import type { StaffRequest, StaffResponse } from './http.types.js';
import {
  ProfilePhotoService,
  PROFILE_PHOTO_POLICY,
  photoVersion,
} from './profile-photo.service.js';
@Controller('api/v1/staff/me/photo')
export class ProfilePhotoController {
  constructor(private readonly photos: ProfilePhotoService) {}
  @Post()
  @HttpCode(200)
  @Authenticated()
  @ImageUpload()
  upload(
    @Headers('x-photo-version') version: unknown,
    @Req() req: StaffRequest,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    const expected = photoVersion(version);
    return this.photos.receive(async () =>
      this.photos.save(
        req.principal!,
        expected,
        req.requestId,
        await readImageBody(req, res, PROFILE_PHOTO_POLICY),
        req.headers['content-type']!.split(';')[0]!.trim().toLowerCase(),
      ),
    );
  }
  @Post('remove')
  @HttpCode(200)
  @Authenticated()
  remove(@Body() body: unknown, @Req() req: StaffRequest) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('expectedVersion' in body) ||
      !Number.isSafeInteger(body.expectedVersion)
    )
      throw new BadRequestException({ code: 'INVALID_PROFILE_PHOTO_VERSION' });
    return this.photos.save(
      req.principal!,
      photoVersion(String(body.expectedVersion)),
      req.requestId,
      null,
    );
  }
  @Get(':version')
  @Authenticated()
  async read(@Req() req: StaffRequest, @Res({ passthrough: true }) res: StaffResponse) {
    const bytes = await this.photos.image(req.principal!, photoVersion(req.params.version));
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Disposition', 'inline; filename="profile.webp"');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    return new StreamableFile(bytes, { length: bytes.length });
  }
}
