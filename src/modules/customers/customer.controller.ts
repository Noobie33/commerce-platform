import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authorization/route-policy.js';
import { permits } from '../authorization/policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { CustomerService } from './customer.service.js';
import {
  uuid,
  customerInput,
  creditInput,
  listQuery,
  matchQuery,
  object,
} from './customer.validation.js';
@Controller('api/v1/customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}
  @Get() @RequirePermission('customers.read') list(@Query() q: unknown) {
    return this.customers.list(listQuery(q));
  }
  @Get('contact-matches') @RequirePermission('customers.read') matches(@Query() q: unknown) {
    return this.customers.matches(matchQuery(q));
  }
  @Get(':id') @RequirePermission('customers.read') read(@Param('id') id: string) {
    return this.customers.read(uuid(id));
  }
  @Get(':id/credit-history') @RequirePermission('customers.credit.manage') history(
    @Param('id') id: string,
    @Query() q: unknown,
    @Req() req: StaffRequest,
  ) {
    if (!permits(req.principal!.grants, 'customers.read')) throw new ForbiddenException();
    object(q, ['page']);
    return this.customers.history(uuid(id), listQuery(q).page);
  }
  @Post() @Authenticated() create(
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.customers.save(
      'create',
      null,
      customerInput(body),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
  @Patch(':id') @Authenticated() update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.customers.save(
      'update',
      uuid(id),
      customerInput(body, true),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
  @Post(':id/credit-policy') @Authenticated() credit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.customers.save(
      'credit',
      uuid(id),
      creditInput(body),
      uuid(key),
      req.principal!.id,
      req.requestId,
    );
  }
}
