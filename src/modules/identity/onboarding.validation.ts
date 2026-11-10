import { BadRequestException } from '@nestjs/common';
import { uuid } from '../catalog/catalog.validation.js';
import type { EnrollmentInput } from './onboarding.types.js';
const invalid = (): never => {
  throw new BadRequestException({
    code: 'ENROLLMENT_INVALID',
    message: 'Check the username, name, revision and reason.',
  });
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : invalid();
const text = (v: unknown, max: number) =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  v.trim().length <= max &&
  !/[\x00-\x1f\x7f]/.test(v)
    ? v.trim().normalize('NFC')
    : invalid();
export function enrollmentInput(v: unknown) {
  const b = obj(v);
  if (
    !['create', 'reissue', 'revoke'].includes(String(b.action)) ||
    Object.keys(b).some(
      (k) =>
        ![
          'action',
          'id',
          'expectedVersion',
          'reason',
          'ownerPassword',
          ...(b.action === 'create' ? ['username', 'displayName'] : []),
        ].includes(k),
    ) ||
    typeof b.ownerPassword !== 'string' ||
    [...b.ownerPassword.normalize('NFC')].length < 1 ||
    [...b.ownerPassword.normalize('NFC')].length > 128 ||
    !Number.isSafeInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 0 ||
    Number(b.expectedVersion) >= 2147483646
  )
    return invalid();
  const input: EnrollmentInput = {
    action: b.action as EnrollmentInput['action'],
    id: uuid(b.id, 'staff'),
    expectedVersion: Number(b.expectedVersion),
    reason: text(b.reason, 500),
  };
  if (input.action === 'create') {
    input.username = text(b.username, 64).toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(input.username) || input.expectedVersion !== 0)
      return invalid();
    input.displayName = text(b.displayName, 120);
  }
  return { input, ownerPassword: b.ownerPassword };
}
export function activationInput(v: unknown) {
  const b = obj(v);
  if (
    Object.keys(b).some((k) => !['username', 'code', 'newPassword'].includes(k)) ||
    typeof b.username !== 'string' ||
    typeof b.code !== 'string' ||
    typeof b.newPassword !== 'string'
  )
    return invalid();
  const username = b.username.trim().toLowerCase(),
    code = b.code.trim(),
    length = [...b.newPassword.normalize('NFC')].length;
  if (!/^[a-z0-9._-]{3,64}$/.test(username) || !/^[A-Za-z0-9_-]{43}$/.test(code))
    throw new BadRequestException({ code: 'ENROLLMENT_ACTIVATION_INVALID' });
  if (length < 15 || length > 128)
    throw new BadRequestException({
      code: 'ACTIVATION_PASSWORD_POLICY',
      message: 'Use a password containing 15 to 128 characters.',
    });
  return { username, code, newPassword: b.newPassword };
}
