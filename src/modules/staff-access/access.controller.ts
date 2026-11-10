import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { uuid } from '../catalog/catalog.validation.js';
import { accessInput, accessKind, accessQuery } from './access.validation.js';
import { StaffAccessService } from './access.service.js';
@Controller('api/v1/access')
export class StaffAccessController {
  constructor(private readonly service: StaffAccessService) {}
  @Get('policy') @RequirePermission('staff.manage') policy(@Req() r: StaffRequest) {
    return this.service.policy(r.principal!.id);
  }
  @Get('choices/:kind') @RequirePermission('staff.manage') choices(
    @Req() r: StaffRequest,
    @Param('kind') kind: string,
    @Query() q: unknown,
  ) {
    return this.service.choices(r.principal!.id, kind, accessQuery(q));
  }
  @Get(':kind') @RequirePermission('staff.manage') list(
    @Req() r: StaffRequest,
    @Param('kind') kind: string,
    @Query() q: unknown,
  ) {
    return this.service.list(r.principal!.id, accessKind(kind), accessQuery(q));
  }
  @Get(':kind/:id') @RequirePermission('staff.manage') read(
    @Req() r: StaffRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.read(
      r.principal!.id,
      accessKind(kind),
      uuid(id, 'subject'),
      accessQuery(q).page,
    );
  }
  @Post() @HttpCode(200) @RequirePermission('staff.manage') post(
    @Req() r: StaffRequest,
    @Body() b: unknown,
    @Headers('x-idempotency-key') k: unknown,
  ) {
    return this.service.post(r.principal!.id, accessInput(b), uuid(k, 'request'), r.requestId);
  }
}
