import { Body, Controller, Get, Post, Param, Query, Headers, Req, HttpCode } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid } from './catalog.validation.js';
import { contentPage } from './content.validation.js';
import { taxonomyInput, taxonomyQuery } from './presentation.validation.js';
import { TaxonomyService } from './presentation.service.js';
@Controller('api/v1/catalog/taxonomy')
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}
  @Get() @RequirePermission('catalog.read') list(@Query() q: unknown) {
    return this.taxonomy.list(taxonomyQuery(q));
  }
  @Get(':id') @RequirePermission('catalog.read') read(
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.taxonomy.read(uuid(id, 'category'), contentPage(q));
  }
  @Post() @HttpCode(200) @RequirePermission('catalog.taxonomy.manage') save(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.taxonomy.save(
      taxonomyInput(body),
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
}
