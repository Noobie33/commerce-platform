import { Controller, Get, Post, Body, Query, Param, Headers, Req, HttpCode } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid } from './catalog.validation.js';
import { contentPage } from './content.validation.js';
import { merchInput, merchQuery } from './merch.validation.js';
import { MerchService } from './merch.service.js';
@Controller('api/v1/catalog/merchandising')
export class MerchController {
  constructor(private readonly merch: MerchService) {}
  @Get() @RequirePermission('catalog.read') list(@Query() q: unknown) {
    return this.merch.list(merchQuery(q));
  }
  @Get(':id') @RequirePermission('catalog.read') read(
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.merch.read(uuid(id, 'merchandising'), contentPage(q));
  }
  @Post() @HttpCode(200) @RequirePermission('catalog.merch.manage') save(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.merch.save(
      merchInput(body),
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
}
