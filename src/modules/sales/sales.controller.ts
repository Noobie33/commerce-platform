import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { SalesService } from './sales.service.js';
import { uuid, salesInput, listQuery, lookupQuery, cancelInput } from './sales.validation.js';
@Controller('api/v1/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Get('customers') @RequirePermission('sales.read') customers(@Query() q: unknown) {
    return this.sales.customers(lookupQuery(q));
  }
  @Get('locations') @RequirePermission('sales.read') locations() {
    return this.sales.locations();
  }
  @Get('variants') @RequirePermission('sales.read') variants(@Query() q: unknown) {
    return this.sales.variants(lookupQuery(q));
  }
  @Get('variants/:id') @RequirePermission('sales.read') variant(@Param('id') id: string) {
    return this.sales.variant(uuid(id));
  }
  @Get('orders') @RequirePermission('sales.read') list(@Query() q: unknown) {
    return this.sales.list(listQuery(q));
  }
  @Get('orders/:id') @RequirePermission('sales.read') read(@Param('id') id: string) {
    return this.sales.read(uuid(id));
  }
  @Post('orders') @Authenticated() create(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.sales.save(
      'create',
      null,
      salesInput(body),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
  @Patch('orders/:id') @Authenticated() update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.sales.save(
      'update',
      uuid(id),
      salesInput(body, true),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
  @Post('orders/:id/cancel') @Authenticated() cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.sales.save(
      'cancel',
      uuid(id),
      cancelInput(body),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
}
