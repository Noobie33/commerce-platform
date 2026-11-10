import { BadRequestException } from '@nestjs/common';
import type { GalleryReviewInput } from './gallery-release.types.js';
export function galleryReviewInput(v: unknown): GalleryReviewInput {
  const bad = (): never => {
    throw new BadRequestException({ code: 'GALLERY_REVIEW_INVALID' });
  };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad();
  const b = v as Record<string, unknown>,
    approve = b.action === 'approve';
  if (
    !['approve', 'revoke'].includes(String(b.action)) ||
    Object.keys(b).some(
      (k) =>
        ![
          'action',
          'expectedVersion',
          'reason',
          ...(approve ? ['expectedDraftVersion', 'expectedBasis', 'rightsConfirmed'] : []),
        ].includes(k),
    ) ||
    !Number.isInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 0 ||
    Number(b.expectedVersion) > 2147483645 ||
    typeof b.reason !== 'string' ||
    !b.reason.trim() ||
    [...b.reason.trim()].length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(b.reason)
  )
    bad();
  const out: GalleryReviewInput = {
    action: b.action as 'approve' | 'revoke',
    expectedVersion: Number(b.expectedVersion),
    reason: (b.reason as string).normalize('NFC').trim(),
  };
  if (approve) {
    if (
      !Number.isInteger(b.expectedDraftVersion) ||
      Number(b.expectedDraftVersion) < 1 ||
      Number(b.expectedDraftVersion) > 2147483646 ||
      typeof b.expectedBasis !== 'string' ||
      !/^[a-f0-9]{64}$/.test(b.expectedBasis) ||
      b.rightsConfirmed !== true
    )
      bad();
    out.expectedDraftVersion = Number(b.expectedDraftVersion);
    out.expectedBasis = b.expectedBasis as string;
    out.rightsConfirmed = true;
  }
  return out;
}
