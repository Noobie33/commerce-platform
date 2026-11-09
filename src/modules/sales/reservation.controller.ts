import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid } from './sales.validation.js';
import { reservationInput, reservationPage } from './reservation.validation.js';
import { ReservationService } from './reservation.service.js';
@Controller('api/v1/sales/orders/:id/reservations')
export class ReservationController {
  constructor(private readonly reservations: ReservationService) {}
  @Get() @RequirePermission('sales.read') read(
    @Param('id') id: string,
    @Query() q: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.reservations.read(uuid(id), reservationPage(q), req.principal!);
  }
  @Post() @Authenticated() hold(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.reservations.post(
      'hold',
      uuid(id),
      reservationInput(body),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
  @Post('release') @Authenticated() release(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.reservations.post(
      'release',
      uuid(id),
      reservationInput(body, true),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
}
