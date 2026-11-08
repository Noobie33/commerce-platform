import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { SupplierService } from './supplier.service.js';
import { PurchaseOrderService } from './purchase-order.service.js';
import {
  uuid,
  supplierInput,
  orderInput,
  pageQuery,
  searchInput,
  actionInput,
} from './purchasing.validation.js';
@Controller('api/v1/purchasing')
export class PurchasingController {
  constructor(
    private readonly suppliers: SupplierService,
    private readonly orders: PurchaseOrderService,
  ) {}
  @Get('suppliers') @RequirePermission('purchasing.read') supplierList(@Query() q: unknown) {
    return this.suppliers.list(pageQuery(q));
  }
  @Get('suppliers/:id') @RequirePermission('purchasing.read') supplier(@Param('id') id: string) {
    return this.suppliers.read(uuid(id));
  }
  @Post('suppliers') @RequirePermission('purchasing.manage') createSupplier(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.suppliers.save(
      null,
      supplierInput(body),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
  @Patch('suppliers/:id') @RequirePermission('purchasing.manage') updateSupplier(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.suppliers.save(
      uuid(id),
      supplierInput(body, true),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
  @Get('locations') @RequirePermission('purchasing.read') locations() {
    return this.orders.locations();
  }
  @Get('variants') @RequirePermission('purchasing.read') variants(@Query() q: unknown) {
    return this.orders.variants(searchInput(q));
  }
  @Get('orders') @RequirePermission('purchasing.read') orderList(@Query() q: unknown) {
    return this.orders.list(pageQuery(q, true));
  }
  @Get('orders/:id') @RequirePermission('purchasing.read') order(@Param('id') id: string) {
    return this.orders.read(uuid(id));
  }
  @Post('orders') @RequirePermission('purchasing.manage') createOrder(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.orders.save(null, orderInput(body), req.principal!.id, uuid(key), req.requestId);
  }
  @Patch('orders/:id') @RequirePermission('purchasing.manage') updateOrder(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.orders.save(
      uuid(id),
      orderInput(body, true),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
  @Post('orders/:id/issue') @RequirePermission('purchasing.manage') issue(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.orders.action(
      uuid(id),
      'issue',
      actionInput(body),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
  @Post('orders/:id/cancel') @RequirePermission('purchasing.manage') cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.orders.action(
      uuid(id),
      'cancel',
      actionInput(body, true),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
}
