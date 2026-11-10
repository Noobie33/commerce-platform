import { BadRequestException } from '@nestjs/common';
import type { PublicationInput } from './publication.types.js';
export function publicationInput(value: unknown, media: boolean): PublicationInput {
  const invalid = (): never => {
    throw new BadRequestException({
      code: 'PUBLICATION_INVALID',
      message: 'Check the action, revision and required reason.',
    });
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const b = value as Record<string, unknown>;
  const keys = media
    ? ['action', 'expectedVersion', 'reason', ...(b.action === 'approve' ? ['alt'] : [])]
    : [
        'action',
        'expectedVersion',
        'reason',
        ...(b.action === 'publish' ? ['expectedProductVersion', 'expectedContentVersion'] : []),
      ];
  const n = (v: unknown, min = 0): number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v < 2147483646 ? v : invalid();
  const text = (v: unknown, max: number): string =>
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.trim().length <= max &&
    !/[\x00-\x1f\x7f]/.test(v)
      ? v.trim().normalize('NFC')
      : invalid();
  if (
    Object.keys(b).some((k) => !keys.includes(k)) ||
    !(media ? ['approve', 'revoke'] : ['publish', 'unpublish']).includes(String(b.action))
  )
    return invalid();
  const result: PublicationInput = {
    action: b.action as PublicationInput['action'],
    expectedVersion: n(b.expectedVersion),
    reason: text(b.reason, 500),
  };
  if (b.action === 'approve') result.alt = text(b.alt, 240);
  if (b.action === 'publish') {
    result.expectedProductVersion = n(b.expectedProductVersion, 1);
    result.expectedContentVersion = n(b.expectedContentVersion, 1);
  }
  return result;
}
