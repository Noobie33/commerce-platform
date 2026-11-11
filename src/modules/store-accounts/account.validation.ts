import { BadRequestException } from '@nestjs/common';
export function accountLogin(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('email' in value) ||
    !('password' in value) ||
    typeof value.email !== 'string' ||
    typeof value.password !== 'string'
  )
    throw new BadRequestException({ code: 'INVALID_CUSTOMER_LOGIN' });
  const email = value.email.trim().toLowerCase(),
    password = value.password;
  if (
    email.length > 254 ||
    !/^[\x21-\x7e]+$/.test(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length > 512 ||
    [...password.normalize('NFC')].length < 1 ||
    [...password.normalize('NFC')].length > 128
  )
    throw new BadRequestException({ code: 'INVALID_CUSTOMER_LOGIN' });
  return { email, password };
}
export function customerToken(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
