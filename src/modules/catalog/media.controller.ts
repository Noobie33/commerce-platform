import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { RequirePermission, ImageUpload } from '../authorization/route-policy.js';
import type { StaffRequest, StaffResponse } from '../identity/http.types.js';
import { readImageBody } from '../../infrastructure/media/read-image-body.js';
import { ProductMediaService } from './media.service.js';
import { uuid } from './catalog.validation.js';
function version(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647)
    throw new BadRequestException({
      code: 'INVALID_MEDIA_VERSION',
      message: 'Reload the product before changing photos.',
    });
  return Number(value);
}
function bodyVersion(body: unknown): number {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => k !== 'expectedVersion') ||
    !('expectedVersion' in body) ||
    !Number.isSafeInteger(body.expectedVersion)
  )
    throw new BadRequestException('Invalid photo request');
  return version(String(body.expectedVersion));
}
@Controller('api/v1/catalog')
export class ProductMediaController {
  constructor(private readonly media: ProductMediaService) {}
  @Post('products/:id/photos')
  @ImageUpload()
  @RequirePermission('catalog.manage')
  upload(
    @Param('id') id: string,
    @Headers('x-product-version') v: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    const productId = uuid(id, 'product'),
      expectedVersion = version(v),
      saveKey = uuid(key, 'save request');
    return this.media.receive(async () =>
      this.media.upload(
        productId,
        expectedVersion,
        saveKey,
        req.principal!.id,
        req.requestId,
        await readImageBody(req, res, this.media.policy),
        req.headers['content-type']!.split(';')[0]!.trim().toLowerCase(),
      ),
    );
  }
  @Post('products/:id/photos/:photoId/primary')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  primary(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Headers('x-idempotency-key') key: unknown,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.media.mutate(
      'primary',
      uuid(id, 'product'),
      uuid(photoId, 'photo'),
      bodyVersion(body),
      uuid(key, 'save request'),
      req.principal!.id,
      req.requestId,
    );
  }
  @Post('products/:id/photos/:photoId/remove')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  remove(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Headers('x-idempotency-key') key: unknown,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.media.mutate(
      'remove',
      uuid(id, 'product'),
      uuid(photoId, 'photo'),
      bodyVersion(body),
      uuid(key, 'save request'),
      req.principal!.id,
      req.requestId,
    );
  }
  @Get('media-policy')
  @RequirePermission('catalog.read')
  policy() {
    return { ...this.media.policy, keepOriginal: true };
  }
  @Get('photos/:photoId/original')
  @RequirePermission('catalog.manage')
  async original(
    @Param('photoId') photoId: string,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    const id = uuid(photoId, 'photo'),
      original = await this.media.original(id),
      extension =
        original.type === 'image/jpeg' ? 'jpg' : original.type === 'image/png' ? 'png' : 'webp';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + id + '.' + extension + '"');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    return new StreamableFile(original.stream, { length: original.bytes });
  }
  @Get('photos/:photoId/:size')
  @RequirePermission('catalog.read')
  async read(
    @Param('photoId') photoId: string,
    @Param('size') size: string,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    if (size !== 'image' && size !== 'thumbnail')
      throw new BadRequestException('Invalid image size');
    const id = uuid(photoId, 'photo');
    const buffer = await this.media.read(id, size);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Disposition', 'inline; filename="' + id + '.webp"');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    return new StreamableFile(buffer);
  }
}
