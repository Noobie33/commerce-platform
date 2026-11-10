import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { GalleryService } from './gallery.service.js';
import { galleryInput } from './gallery.validation.js';
import { uuid } from './catalog.validation.js';
import { contentPage } from './content.validation.js';
@Controller('api/v1/catalog/products/:id/gallery')
export class GalleryController {
  constructor(private readonly service: GalleryService) {}
  @Get() @RequirePermission('catalog.read') read(@Param('id') id: string, @Query() q: unknown) {
    return this.service.read(uuid(id, 'product'), contentPage(q));
  }
  @Post() @HttpCode(200) @RequirePermission('catalog.manage') save(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.service.save(
      uuid(id, 'product'),
      galleryInput(b),
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
}
