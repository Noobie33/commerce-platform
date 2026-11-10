import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  NotFoundException,
} from '@nestjs/common';
import { Public, RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest, StaffResponse } from '../identity/http.types.js';
import { PublicationService } from './publication.service.js';
import { publicationInput } from './publication.validation.js';
import { uuid } from './catalog.validation.js';
import { contentPage } from './content.validation.js';
@Controller('api/v1/catalog/products/:id/publication')
export class PublicationController {
  constructor(private readonly service: PublicationService) {}
  @Get() @RequirePermission('catalog.read') read(@Param('id') id: string, @Query() q: unknown) {
    return this.service.read(uuid(id, 'product'), contentPage(q));
  }
  @Post() @HttpCode(200) @RequirePermission('catalog.publish') post(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.service.post(
      uuid(id, 'product'),
      null,
      publicationInput(b, false),
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
  @Post('photos/:photoId') @HttpCode(200) @RequirePermission('catalog.media.review') media(
    @Param('id') id: string,
    @Param('photoId') photo: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.service.post(
      uuid(id, 'product'),
      uuid(photo, 'photo'),
      publicationInput(b, true),
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
}
@Controller('api/v1/store')
export class StoreProductController {
  constructor(private readonly service: PublicationService) {}
  @Get('products/:slug') @Public() read(@Param('slug') slug: string) {
    return this.service.publicProduct(slug);
  }
  @Get('photos/:photoId/:size') @Public() async photo(
    @Param('photoId') photo: string,
    @Param('size') size: string,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    if (
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(photo) ||
      (size !== 'image' && size !== 'thumbnail')
    )
      throw new NotFoundException();
    const bytes = await this.service.publicPhoto(photo, size);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Disposition', 'inline; filename="' + photo + '.webp"');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    return new StreamableFile(bytes);
  }
}
