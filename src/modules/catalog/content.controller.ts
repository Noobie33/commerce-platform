import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid } from './catalog.validation.js';
import { ProductContentService } from './content.service.js';
import { contentInput, contentPage } from './content.validation.js';
@Controller('api/v1/catalog/products/:id/content')
export class ProductContentController {
  constructor(private readonly content: ProductContentService) {}
  @Get() @RequirePermission('catalog.read') read(@Param('id') id: string, @Query() query: unknown) {
    return this.content.read(uuid(id, 'product'), contentPage(query));
  }
  @Post() @HttpCode(200) @Authenticated() post(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.content.post(
      uuid(id, 'product'),
      contentInput(body),
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
}
