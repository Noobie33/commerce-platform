import { ProfilePhotoService } from './profile-photo.service.js';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { IdentityService } from './identity.service.js';
import { AUTH_CONFIG } from './auth.config.js';
import type { AuthConfig } from './auth.config.js';
import type { StaffRequest, StaffResponse } from './http.types.js';
import {
  Authenticated,
  PasswordChangeAllowed,
  Public,
  RequirePermission,
} from '../authorization/route-policy.js';

function fields(body: unknown, expected: string[]): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Invalid request');
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).length !== expected.length ||
    Object.keys(value).some((key) => !expected.includes(key)) ||
    expected.some(
      (key) =>
        typeof value[key] !== 'string' ||
        (value[key] as string).length < 1 ||
        (value[key] as string).length > 512,
    )
  ) {
    throw new BadRequestException('Invalid request');
  }
  return value as Record<string, string>;
}

@Controller('api/v1')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly photos: ProfilePhotoService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  private cookie(token: string, age: number): string {
    return (
      this.config.cookieName +
      '=' +
      token +
      '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
      age +
      (this.config.secure ? '; Secure' : '')
    );
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: StaffRequest,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    const input = fields(body, ['username', 'password']);
    const username = input.username!.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(username) || [...input.password!.normalize('NFC')].length > 128)
      throw new BadRequestException('Invalid request');
    const result = await this.identity.login(
      username,
      input.password!,
      req.socket.remoteAddress ?? 'unknown',
      req.requestId,
    );
    res.setHeader('Set-Cookie', this.cookie(result.token, 8 * 60 * 60));
    return { user: result.user, csrfToken: result.csrfToken };
  }

  @Authenticated()
  @PasswordChangeAllowed()
  @Get('staff/me')
  async me(@Req() req: StaffRequest) {
    const user = req.principal!;
    return {
      demo: this.config.demo ?? false,
      profilePhoto: await this.photos.metadata(user),
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
      grants: user.grants,
      csrfToken: user.csrfToken,
    };
  }

  @Authenticated()
  @PasswordChangeAllowed()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: StaffRequest, @Res({ passthrough: true }) res: StaffResponse) {
    await this.identity.logout(req.principal!, req.requestId);
    res.setHeader('Set-Cookie', this.cookie('', 0));
    return { status: 'ok' };
  }

  @Authenticated()
  @PasswordChangeAllowed()
  @Post('auth/password')
  @HttpCode(200)
  async password(
    @Body() body: unknown,
    @Req() req: StaffRequest,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    const input = fields(body, ['currentPassword', 'newPassword']);
    await this.identity.changePassword(
      req.principal!,
      input.currentPassword!,
      input.newPassword!,
      req.requestId,
    );
    res.setHeader('Set-Cookie', this.cookie('', 0));
    return { status: 'ok', loginRequired: true };
  }

  @RequirePermission('staff.read')
  @Get('staff')
  list() {
    return this.identity.listStaff();
  }
}
