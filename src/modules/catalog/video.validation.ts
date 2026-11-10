import { BadRequestException } from '@nestjs/common';
import { uuid } from './catalog.validation.js';
const invalid = (): never => {
  throw new BadRequestException({
    code: 'VIDEO_INVALID',
    message: 'Check the video details, reason and current revision.',
  });
};
export function videoVersion(v: unknown) {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,9}$/.test(v) || Number(v) > 2147483646) invalid();
  return Number(v);
}
export function videoAction(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid();
  const b = v as Record<string, unknown>,
    op = b.action;
  if (
    typeof op !== 'string' ||
    !['metadata', 'retry', 'cancel', 'remove', 'approve', 'revoke'].includes(op)
  )
    invalid();
  const keys =
    op === 'metadata'
      ? ['action', 'expectedVersion', 'reason', 'description', 'variantId', 'position']
      : op === 'approve'
        ? ['action', 'expectedVersion', 'reason', 'rightsConfirmed']
        : ['action', 'expectedVersion', 'reason'];
  if (Object.keys(b).some((k) => !keys.includes(k))) invalid();
  const text = (x: unknown, max: number, required = true) => {
    if (typeof x !== 'string') invalid();
    const s = (x as string).normalize('NFC').trim();
    if ((required && !s) || [...s].length > max || /[\u0000-\u001f\u007f]/u.test(s)) invalid();
    return s;
  };
  if (
    !Number.isInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 1 ||
    Number(b.expectedVersion) > 2147483646
  )
    invalid();
  const r: Record<string, unknown> = {
    action: op,
    expectedVersion: b.expectedVersion,
    reason: text(b.reason, 500),
  };
  if (op === 'metadata') {
    r.description = text(b.description, 240, false);
    r.variantId = b.variantId === null ? null : uuid(b.variantId, 'variant');
    if (!Number.isInteger(b.position) || Number(b.position) < 0 || Number(b.position) > 99999)
      invalid();
    r.position = b.position;
  }
  if (op === 'approve') {
    if (b.rightsConfirmed !== true) invalid();
    r.rightsConfirmed = true;
  }
  return r;
}
export function videoPage(v: unknown) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !['page', 'removed'].includes(k))
  )
    invalid();
  const b = v as Record<string, unknown>;
  if (b.removed !== undefined && b.removed !== '1') invalid();
  if (b.page !== undefined && (typeof b.page !== 'string' || !/^[1-9][0-9]{0,3}$/.test(b.page)))
    invalid();
  return { page: Number(b.page ?? 1), removed: b.removed === '1' };
}
export function videoRange(raw: string | undefined, length: number) {
  if (!raw) return { start: 0, end: length - 1, status: 200 };
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw);
  if (!m || (!m[1] && !m[2])) return null;
  let start = m[1] ? Number(m[1]) : Math.max(0, length - Number(m[2])),
    end = m[1] ? (m[2] ? Number(m[2]) : length - 1) : length - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= length ||
    end < start ||
    (!m[1] && Number(m[2]) === 0)
  )
    return null;
  end = Math.min(end, length - 1);
  return { start, end, status: 206 };
}
