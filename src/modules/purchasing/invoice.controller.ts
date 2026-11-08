import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, Authenticated } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid, object, text, invalid } from './purchasing.validation.js';
import { invoiceInput, reverseInvoiceInput, invoicePages } from './invoice.validation.js';
import { SupplierInvoiceService } from './invoice.service.js';
@Controller('api/v1/payables')
export class SupplierInvoiceController {
  constructor(private readonly invoices: SupplierInvoiceService) {}
  @Get('invoices') @RequirePermission('payables.read') list(
    @Query() value: unknown,
    @Req() req: StaffRequest,
  ) {
    const r = object(value, ['page', 'search', 'status']),
      pages = invoicePages({ page: r.page });
    const status = String(r.status ?? 'all');
    if (!['all', 'active', 'reversed', 'unpaid', 'partial', 'paid', 'overdue'].includes(status))
      invalid('Invalid invoice status');
    return this.invoices.list(
      { page: pages.page, search: text(r.search ?? '', 'search', 100, true), status },
      req.principal!,
    );
  }
  @Get('orders/:id') @RequirePermission('payables.read') order(
    @Param('id') id: string,
    @Query() q: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.invoices.order(uuid(id), invoicePages(q), req.principal!);
  }
  @Post('orders/:id/invoices') @Authenticated() post(
    @Param('id') id: string,
    @Body() value: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.invoices.post(invoiceInput(id, value), req.principal!.id, uuid(key), req.requestId);
  }
  @Post('invoices/:id/reverse') @Authenticated() reverse(
    @Param('id') id: string,
    @Body() value: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.invoices.post(
      reverseInvoiceInput(id, value),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
}
