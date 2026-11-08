import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { CatalogService } from './catalog.service.js';
import { categoryInput, catalogQuery, productInput, uuid } from './catalog.validation.js';

@Controller('api/v1/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @RequirePermission('catalog.read')
  categories() {
    return this.catalog.categories();
  }

  @Post('categories')
  @RequirePermission('catalog.manage')
  category(@Body() body: unknown, @Req() req: StaffRequest) {
    return this.catalog.createCategory(categoryInput(body), req.principal!.id, req.requestId);
  }

  @Get('products')
  @RequirePermission('catalog.read')
  list(@Query() query: unknown) {
    return this.catalog.list(catalogQuery(query));
  }

  @Get('products/:id')
  @RequirePermission('catalog.read')
  detail(@Param('id') id: string) {
    return this.catalog.read(uuid(id, 'product'));
  }

  @Post('products')
  @RequirePermission('catalog.manage')
  create(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.catalog.save(
      productInput(body, false),
      null,
      req.principal!.id,
      req.requestId,
      uuid(key, 'save request'),
    );
  }

  @Patch('products/:id')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.catalog.save(
      productInput(body, true),
      uuid(id, 'product'),
      req.principal!.id,
      req.requestId,
      uuid(key, 'save request'),
    );
  }
}
