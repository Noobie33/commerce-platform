import { BadRequestException } from '@nestjs/common';
import type { SeoInput, TaxonomyInput } from './presentation.types.js';
function invalid(): never {
  throw new BadRequestException({
    code: 'INVALID_PRESENTATION_INPUT',
    message: 'Check category, URL name, SEO fields and revision before saving.',
  });
}
function obj(v: unknown, keys: string[]) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max: number, required = false) {
  if (typeof v !== 'string') invalid();
  const s = v.normalize('NFC').trim();
  if ([...s].length > max || (required && !s) || /[\u0000-\u001f\u007f]/u.test(s)) invalid();
  return s;
}
function id(v: unknown) {
  if (typeof v !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v)) invalid();
  return v.toLowerCase();
}
export function seoInput(v: unknown): SeoInput {
  const b = obj(v, ['title', 'description']);
  return {
    title: text(b.title, 80),
    description: text(
      typeof b.description === 'string' ? b.description.replace(/[\t\r\n]+/g, ' ') : b.description,
      320,
    ),
  };
}
export function taxonomyInput(v: unknown): TaxonomyInput {
  const b = obj(v, [
    'id',
    'expectedVersion',
    'name',
    'parentId',
    'active',
    'slug',
    'seo',
    'reason',
  ]);
  if (
    typeof b.active !== 'boolean' ||
    !Number.isInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 0 ||
    Number(b.expectedVersion) > 2147483645
  )
    invalid();
  const slug = text(b.slug, 120);
  if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) invalid();
  return {
    id: id(b.id),
    expectedVersion: b.expectedVersion as number,
    name: text(b.name, 80, true),
    parentId: b.parentId === null ? null : id(b.parentId),
    active: b.active,
    slug,
    seo: seoInput(b.seo),
    reason: text(b.reason, 500, true),
  };
}
export function taxonomyQuery(v: unknown) {
  const b = obj(v, ['search', 'status', 'page']);
  const search = b.search === undefined ? '' : text(b.search, 100),
    status = b.status ?? 'all';
  if (
    !['all', 'active', 'retired'].includes(String(status)) ||
    (b.page !== undefined && (typeof b.page !== 'string' || !/^[1-9][0-9]{0,5}$/.test(b.page)))
  )
    invalid();
  return { search, status: String(status), page: b.page === undefined ? 1 : Number(b.page) };
}
