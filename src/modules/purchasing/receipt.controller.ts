import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { PurchaseReceiptService } from './receipt.service.js';
import { uuid } from './purchasing.validation.js';
import { receiptInput, reverseReceiptInput, receiptPage } from './receipt.validation.js';
@Controller('api/v1/purchasing')
export class PurchaseReceiptController {
  constructor(private readonly receipts: PurchaseReceiptService) {}
  @Get('orders/:id/receiving') @RequirePermission('purchasing.read') receiving(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.receipts.receiving(uuid(id), receiptPage(query), req.principal!);
  }
  @Post('orders/:id/receipts') @Authenticated() receive(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.receipts.post(receiptInput(id, body), req.principal!.id, uuid(key), req.requestId);
  }
  @Post('receipts/:id/reverse') @Authenticated() reverse(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.receipts.post(
      reverseReceiptInput(id, body),
      req.principal!.id,
      uuid(key),
      req.requestId,
    );
  }
}
