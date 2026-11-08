import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, Authenticated } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid, object, text, invalid, searchInput } from './purchasing.validation.js';
import { paymentInput, reversePaymentInput, paymentPages } from './payment.validation.js';
import { SupplierPaymentService } from './payment.service.js';
@Controller('api/v1/payables')
export class SupplierPaymentController {
  constructor(private readonly payments: SupplierPaymentService) {}
  @Get('payment-suppliers') @RequirePermission('payables.read') suppliers(
    @Query() q: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.payments.suppliers(searchInput(q), req.principal!);
  }
  @Get('payments') @RequirePermission('payables.read') list(
    @Query() q: unknown,
    @Req() req: StaffRequest,
  ) {
    const r = object(q, ['page', 'search', 'status']),
      status = String(r.status ?? 'all');
    if (!['all', 'active', 'reversed'].includes(status)) invalid('Invalid payment status');
    return this.payments.list(
      {
        page: paymentPages({ page: r.page }).page,
        search: text(r.search ?? '', 'search', 100, true),
        status,
      },
      req.principal!,
    );
  }
  @Get('suppliers/:id/payments') @RequirePermission('payables.read') supplier(
    @Param('id') id: string,
    @Query() q: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.payments.supplier(uuid(id), paymentPages(q), req.principal!);
  }
  @Post('suppliers/:id/payments') @Authenticated() post(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.payments.post(paymentInput(id, b), req.principal!.id, uuid(key), req.requestId);
  }
  @Post('payments/:id/reverse') @Authenticated() reverse(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.payments.post(
      reversePaymentInput(id, b),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
}
