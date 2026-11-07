import { SetMetadata } from '@nestjs/common';

export const PUBLIC = 'staff.public';
export const AUTHENTICATED = 'staff.authenticated';
export const PASSWORD_CHANGE_ALLOWED = 'staff.password_change_allowed';
export const PERMISSION = 'staff.permission';
export const Public = () => SetMetadata(PUBLIC, true);
export const Authenticated = () => SetMetadata(AUTHENTICATED, true);
export const PasswordChangeAllowed = () => SetMetadata(PASSWORD_CHANGE_ALLOWED, true);
export const RequirePermission = (code: string, locationParam?: string) =>
  SetMetadata(PERMISSION, { code, locationParam });
