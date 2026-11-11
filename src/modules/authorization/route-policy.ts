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

export const IMAGE_UPLOAD = 'staff.image_upload';
export const ImageUpload = () => SetMetadata(IMAGE_UPLOAD, true);

export const BACKGROUND_READ = 'staff.background_read';
export const BackgroundRead = () => SetMetadata(BACKGROUND_READ, true);

export const VIDEO_UPLOAD = 'staff.video_upload';
export const VideoUpload = () => SetMetadata(VIDEO_UPLOAD, true);

// Opt-in for bounded public POST queries that never mutate application data.
export const PUBLIC_BODY_READ = 'store.public_body_read';
export const PublicBodyRead = () => SetMetadata(PUBLIC_BODY_READ, true);
