import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Public, STORE_CUSTOMER_ENDPOINT } from '../authorization/route-policy.js';
import type { StaffRequest } from '../identity/http.types.js';
import { StoreAccountBoundaryGuard } from './account.guard.js';
import { StoreAccountService } from './account.service.js';
import { accountLogin } from './account.validation.js';
function noQuery(q: Record<string, unknown>) {
  if (Object.keys(q).length) throw new BadRequestException({ code: 'INVALID_CUSTOMER_QUERY' });
}
@Controller('api/v1/store/account')
@Public()
@SetMetadata(STORE_CUSTOMER_ENDPOINT, true)
@UseGuards(StoreAccountBoundaryGuard)
export class StoreAccountController {
  constructor(private readonly accounts: StoreAccountService) {}
  @Get('status') status(@Query() q: Record<string, unknown>) {
    noQuery(q);
    return { mode: this.accounts.mode, registration: false, recovery: false };
  }
  @Post('login') @HttpCode(200) login(
    @Body() body: unknown,
    @Req() req: StaffRequest,
    @Query() q: Record<string, unknown>,
  ) {
    noQuery(q);
    const v = accountLogin(body);
    return this.accounts.login(
      v.email,
      v.password,
      req.socket.remoteAddress ?? 'unknown',
      req.requestId,
    );
  }
  @Get('session') session(@Req() req: StaffRequest, @Query() q: Record<string, unknown>) {
    noQuery(q);
    return this.accounts.session(req.headers['x-customer-session']);
  }
  @Post('logout') @HttpCode(200) logout(
    @Body() body: unknown,
    @Req() req: StaffRequest,
    @Query() q: Record<string, unknown>,
  ) {
    noQuery(q);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
      throw new BadRequestException({ code: 'INVALID_CUSTOMER_QUERY' });
    return this.accounts.logout(
      req.headers['x-customer-session'],
      req.headers['x-customer-csrf'],
      req.requestId,
    );
  }
}
