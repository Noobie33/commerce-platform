import { BadRequestException } from '@nestjs/common';
import type { GalleryInput } from './gallery.types.js';
const bad = (): never => {
  throw new BadRequestException({
    code: 'GALLERY_INVALID',
    message: 'Check the gallery order, current revision and reason.',
  });
};
export function galleryInput(v: unknown): GalleryInput {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad();
  const b = v as Record<string, unknown>;
  if (
    Object.keys(b).some(
      (k) => !['action', 'expectedVersion', 'expectedBasis', 'reason', 'items'].includes(k),
    ) ||
    b.action !== 'save' ||
    !Number.isInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 0 ||
    Number(b.expectedVersion) > 2147483645 ||
    typeof b.expectedBasis !== 'string' ||
    !/^[a-f0-9]{64}$/.test(b.expectedBasis) ||
    typeof b.reason !== 'string' ||
    !b.reason.trim() ||
    [...b.reason.trim()].length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(b.reason) ||
    !Array.isArray(b.items) ||
    b.items.length > 40
  )
    bad();
  const items = (b.items as unknown[]).map((x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) bad();
    const i = x as Record<string, unknown>;
    if (
      Object.keys(i).some((k) => !['kind', 'id'].includes(k)) ||
      !['photo', 'video'].includes(String(i.kind)) ||
      typeof i.id !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(i.id)
    )
      bad();
    return { kind: i.kind as 'photo' | 'video', id: i.id as string };
  });
  if (new Set(items.map((x) => x.kind + ':' + x.id)).size !== items.length) bad();
  return {
    action: 'save',
    expectedVersion: Number(b.expectedVersion),
    expectedBasis: b.expectedBasis as string,
    reason: (b.reason as string).normalize('NFC').trim(),
    items,
  };
}
