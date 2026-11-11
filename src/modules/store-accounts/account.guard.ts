import { ForbiddenException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { StaffRequest } from '../identity/http.types.js';
export class StoreAccountBoundaryGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const r = ctx.switchToHttp().getRequest<StaffRequest>();
    if (r.method === 'GET') return true;
    const host = r.headers.host ?? '',
      type = r.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (
      r.method !== 'POST' ||
      !/^(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/.test(host) ||
      r.headers.origin !== 'http://' + host ||
      r.headers['x-requested-with'] !== 'commerce-store-server' ||
      type !== 'application/json' ||
      r.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new ForbiddenException({ code: 'CUSTOMER_REQUEST_DENIED' });
    return true;
  }
}
