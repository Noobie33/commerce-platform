import { BadRequestException } from '@nestjs/common';
import { uuid } from '../catalog/catalog.validation.js';
import type { AccessInput, AccessKind } from './access.types.js';
const invalid = (): never => {
  throw new BadRequestException({
    code: 'ACCESS_INVALID',
    message: 'Check the name, permissions, locations and reason.',
  });
};
export const accessKind = (k: string): AccessKind =>
  k === 'staff' || k === 'role' ? k : invalid();
export function accessQuery(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
  const b = v as Record<string, unknown>;
  if (
    Object.keys(b).some((k) => !['search', 'page'].includes(k)) ||
    (b.search !== undefined && (typeof b.search !== 'string' || b.search.length > 120)) ||
    (b.page !== undefined && (typeof b.page !== 'string' || !/^[1-9]\d{0,4}$/.test(b.page)))
  )
    return invalid();
  return {
    search: typeof b.search === 'string' ? b.search.trim() : '',
    page: b.page === undefined ? 1 : Number(b.page),
  };
}
function text(v: unknown, max: number) {
  return typeof v === 'string' &&
    v.trim().length > 0 &&
    v.trim().length <= max &&
    !/[\x00-\x1f\x7f]/.test(v)
    ? v.trim().normalize('NFC')
    : invalid();
}
export function accessInput(v: unknown): AccessInput {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
  const b = v as Record<string, unknown>,
    kind = accessKind(String(b.kind)),
    keys = [
      'kind',
      'id',
      'expectedVersion',
      'active',
      'reason',
      ...(kind === 'staff' ? ['displayName', 'assignments'] : ['code', 'label', 'permissions']),
    ];
  if (
    Object.keys(b).some((k) => !keys.includes(k)) ||
    typeof b.active !== 'boolean' ||
    !Number.isSafeInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 0 ||
    Number(b.expectedVersion) >= 2147483646
  )
    return invalid();
  const result: AccessInput = {
    kind,
    id: uuid(b.id, 'subject'),
    expectedVersion: Number(b.expectedVersion),
    active: b.active,
    reason: text(b.reason, 500),
  };
  if (kind === 'staff') {
    result.displayName = text(b.displayName, 120);
    if (!Array.isArray(b.assignments) || b.assignments.length > 20) return invalid();
    result.assignments = b.assignments
      .map((a) => {
        if (
          !a ||
          typeof a !== 'object' ||
          Array.isArray(a) ||
          Object.keys(a).some((k) => !['roleId', 'locationId'].includes(k)) ||
          !('locationId' in a)
        )
          return invalid();
        return {
          roleId: uuid(a.roleId, 'role'),
          locationId: a.locationId === null ? null : uuid(a.locationId, 'location'),
        };
      })
      .sort((a, b) =>
        (a.roleId + String(a.locationId)).localeCompare(b.roleId + String(b.locationId)),
      );
    if (
      new Set(result.assignments.map((a) => JSON.stringify(a))).size !== result.assignments.length
    )
      return invalid();
  } else {
    result.code = text(b.code, 64);
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(result.code)) return invalid();
    result.label = text(b.label, 120);
    if (
      !Array.isArray(b.permissions) ||
      b.permissions.length > 64 ||
      b.permissions.some((p) => typeof p !== 'string' || !/^[a-z][a-z._]+$/.test(p))
    )
      return invalid();
    result.permissions = [...(b.permissions as string[])].sort();
    if (new Set(result.permissions).size !== result.permissions.length) return invalid();
  }
  return result;
}
