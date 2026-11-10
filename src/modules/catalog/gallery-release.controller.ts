import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid } from './catalog.validation.js';
import { galleryReviewInput } from './gallery-release.validation.js';
import { GalleryReleaseService } from './gallery-release.service.js';
@Controller('api/v1/catalog/products/:id/gallery/review')
export class GalleryReviewController {
  constructor(private readonly service: GalleryReleaseService) {}
  @Post() @HttpCode(200) @RequirePermission('catalog.media.review') post(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.service.post(
      uuid(id, 'product'),
      galleryReviewInput(b),
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
}
