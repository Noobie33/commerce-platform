import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { InventoryService } from './inventory.service.js';
import {
  inventoryQuery,
  locationInput,
  reversalInput,
  stockInput,
  uuid,
  variantSearch,
} from './inventory.validation.js';
@Controller('api/v1/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('locations')
  @Authenticated()
  locations(@Req() req: StaffRequest) {
    return this.inventory.locations(req.principal!);
  }
  @Post('locations')
  @RequirePermission('locations.manage')
  create(@Body() body: unknown, @Req() req: StaffRequest) {
    return this.inventory.createLocation(locationInput(body), req.principal!.id, req.requestId);
  }
  @Get('locations/:locationId/stock')
  @RequirePermission('inventory.read', 'locationId')
  stock(@Param('locationId') id: string, @Query() query: unknown) {
    return this.inventory.stock(id, inventoryQuery(query));
  }
  @Get('locations/:locationId/history')
  @RequirePermission('inventory.read', 'locationId')
  history(@Param('locationId') id: string, @Query() query: unknown, @Req() req: StaffRequest) {
    return this.inventory.history(id, inventoryQuery(query, true), req.principal!);
  }
  @Get('locations/:locationId/variants')
  @RequirePermission('inventory.read', 'locationId')
  variants(@Param('locationId') id: string, @Query() query: unknown) {
    return this.inventory.variants(id, variantSearch(query));
  }
  @Post('postings')
  @Authenticated()
  post(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.inventory.post(
      stockInput(body),
      uuid(key, 'save request'),
      req.principal!,
      req.requestId,
    );
  }
  @Get('postings/:id/reversal-preview')
  @Authenticated()
  preview(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.inventory.reversalPreview(uuid(id, 'posting'), req.principal!);
  }
  @Post('postings/:id/reverse')
  @Authenticated()
  reverse(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.inventory.post(
      reversalInput(id, body),
      uuid(key, 'save request'),
      req.principal!,
      req.requestId,
    );
  }
}
