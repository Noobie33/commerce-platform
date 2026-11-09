import { Controller, Get, Req, Res, Inject, ForbiddenException } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { StaffRequest } from '../identity/http.types.js';
import { Authenticated, BackgroundRead } from '../authorization/route-policy.js';
import { AUTH_CONFIG, type AuthConfig } from '../identity/auth.config.js';
import { LiveUpdatesService } from './live-updates.service.js';
@Controller('api/v1/staff')
export class LiveUpdatesController {
  constructor(
    private readonly live: LiveUpdatesService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}
  @Get('events')
  @Authenticated()
  @BackgroundRead()
  events(@Req() req: StaffRequest, @Res() res: ServerResponse) {
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      (req.headers.origin && req.headers.origin !== this.config.origin)
    )
      throw new ForbiddenException('Request verification failed');
    const cookie = (req.headers.cookie ?? '')
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(this.config.cookieName + '='))!;
    this.live.open(cookie.slice(this.config.cookieName.length + 1), req.principal!, res);
  }
}
