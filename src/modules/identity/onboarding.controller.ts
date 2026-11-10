import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Public, RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from './http.types.js';
import { uuid } from '../catalog/catalog.validation.js';
import { accessQuery } from '../staff-access/access.validation.js';
import { enrollmentInput, activationInput } from './onboarding.validation.js';
import { StaffOnboardingService } from './onboarding.service.js';
@Controller('api/v1')
export class StaffOnboardingController {
  constructor(private readonly service: StaffOnboardingService) {}
  @Get('staff-onboarding') @RequirePermission('staff.manage') list(
    @Req() r: StaffRequest,
    @Query() q: unknown,
  ) {
    return this.service.list(r.principal!.id, accessQuery(q));
  }
  @Get('staff-onboarding/:id') @RequirePermission('staff.manage') read(
    @Req() r: StaffRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.read(r.principal!.id, uuid(id, 'staff'), accessQuery(q).page);
  }
  @Post('staff-onboarding') @HttpCode(200) @RequirePermission('staff.manage') post(
    @Req() r: StaffRequest,
    @Body() b: unknown,
    @Headers('x-idempotency-key') k: unknown,
  ) {
    const v = enrollmentInput(b);
    return this.service.post(
      r.principal!,
      v.input,
      v.ownerPassword,
      uuid(k, 'request'),
      r.requestId,
    );
  }
  @Post('auth/activate') @HttpCode(200) @Public() activate(
    @Req() r: StaffRequest,
    @Body() b: unknown,
  ) {
    return this.service.activate(
      activationInput(b),
      r.socket.remoteAddress ?? 'unknown',
      r.requestId,
    );
  }
}
