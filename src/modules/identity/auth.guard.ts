import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permits } from '../authorization/policy.js';
import { IdentityService } from './identity.service.js';
import {
  AUTHENTICATED,
  BACKGROUND_READ,
  IMAGE_UPLOAD,
  VIDEO_UPLOAD,
  PASSWORD_CHANGE_ALLOWED,
  PERMISSION,
  PUBLIC,
} from '../authorization/route-policy.js';
import type { AuthConfig } from './auth.config.js';
import type { StaffRequest } from './http.types.js';

export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
    private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '');
    const type = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    const imageUpload = this.reflector.getAllAndOverride<boolean>(IMAGE_UPLOAD, targets);
    const videoUpload = this.reflector.getAllAndOverride<boolean>(VIDEO_UPLOAD, targets);
    const validContentType = videoUpload
      ? ['video/mp4', 'video/quicktime'].includes(type ?? '')
      : imageUpload
        ? ['image/jpeg', 'image/png', 'image/webp'].includes(type ?? '')
        : type === 'application/json';
    // Public login is also origin-checked. No wildcard CORS is enabled.
    if (
      writing &&
      (req.headers.origin !== this.config.origin ||
        req.headers['x-requested-with'] !== 'commerce-staff' ||
        !validContentType ||
        req.headers['sec-fetch-site'] === 'cross-site')
    ) {
      throw new ForbiddenException('Request verification failed');
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const cookies = (req.headers.cookie ?? '')
      .split(';')
      .map((cookie) => cookie.trim())
      .filter((cookie) => cookie.startsWith(this.config.cookieName + '='));
    if (cookies.length !== 1) throw new UnauthorizedException('Authentication required');
    const token = cookies[0]!.slice(this.config.cookieName.length + 1);
    const backgroundRead =
      req.method === 'GET' &&
      (req.headers['x-background-read'] === '1' ||
        this.reflector.getAllAndOverride<boolean>(BACKGROUND_READ, targets));
    const principal = await this.identity.authenticate(token, !backgroundRead);
    req.principal = principal;
    if (writing) this.identity.assertCsrf(principal, req.headers['x-csrf-token']);
    if (
      principal.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_ALLOWED, targets)
    ) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    const permission = this.reflector.getAllAndOverride<{ code: string; locationParam?: string }>(
      PERMISSION,
      targets,
    );
    if (!permission) {
      if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED, targets)) return true;
      throw new ForbiddenException('Permission required');
    }
    let locationId: string | undefined;
    if (permission.locationParam) {
      locationId = req.params[permission.locationParam]?.toLowerCase();
      if (!locationId || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(locationId))
        throw new BadRequestException('Invalid location');
    }
    if (!permits(principal.grants, permission.code, locationId)) {
      await this.identity.denied(principal, permission.code, req.requestId);
      throw new ForbiddenException('Permission denied');
    }
    return true;
  }
}
