import { materialGroupsV1, occasionCodesV1 } from '../../database/catalog-vocabularies-v1.js';
import { BadRequestException } from '@nestjs/common';
import { fold } from './catalog.validation.js';
export interface StoreBrowseQuery {
  q: string;
  category: string | null;
  size: string | null;
  color: string | null;
  fit: string | null;
  materialGroup: string | null;
  occasion: string | null;
  minPriceMinor: string | null;
  maxPriceMinor: string | null;
  sort: 'name' | 'price_asc' | 'price_desc';
  page: number;
  pageSize: number;
}
function invalid(): never {
  throw new BadRequestException({
    code: 'INVALID_STORE_QUERY',
    message: 'Check search, filters and page limits.',
  });
}
export function storeBrowseQuery(value: unknown): StoreBrowseQuery {
  const keys = [
    'q',
    'category',
    'size',
    'color',
    'fit',
    'materialGroup',
    'occasion',
    'minPriceMinor',
    'maxPriceMinor',
    'sort',
    'page',
    'pageSize',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).some((k) => !keys.includes(k)) ||
    Object.values(b).some((v) => typeof v !== 'string') ||
    Buffer.byteLength(JSON.stringify(b), 'utf8') > 1400
  )
    invalid();
  function text(key: string, max: number): string | null {
    if (!(key in b)) return null;
    const v = fold(b[key] as string);
    if (!v || [...v].length > max || /[\u0000-\u001f\u007f]/u.test(b[key] as string)) invalid();
    return v;
  }
  function amount(key: string): string | null {
    if (!(key in b)) return null;
    if (!/^(0|[1-9][0-9]{0,11})$/.test(b[key] as string)) invalid();
    return b[key] as string;
  }
  const category = text('category', 120),
    fit = text('fit', 30);
  if (category && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(category)) invalid();
  if (fit && !['regular', 'slim', 'relaxed', 'oversized', 'not_applicable'].includes(fit))
    invalid();
  const materialGroup = text('materialGroup', 40),
    occasion = text('occasion', 40);
  if (materialGroup && !(materialGroupsV1 as readonly string[]).includes(materialGroup)) invalid();
  if (occasion && !occasionCodesV1.includes(occasion)) invalid();
  const minPriceMinor = amount('minPriceMinor'),
    maxPriceMinor = amount('maxPriceMinor');
  if (
    minPriceMinor !== null &&
    maxPriceMinor !== null &&
    BigInt(minPriceMinor) > BigInt(maxPriceMinor)
  )
    invalid();
  if ('page' in b && (!/^[1-9][0-9]{0,3}$/.test(b.page as string) || Number(b.page) > 1000))
    invalid();
  if ('pageSize' in b && !['12', '24', '48'].includes(b.pageSize as string)) invalid();
  if ('sort' in b && !['name', 'price_asc', 'price_desc'].includes(b.sort as string)) invalid();
  return {
    q: text('q', 80) ?? '',
    category,
    size: text('size', 60),
    color: text('color', 60),
    fit,
    materialGroup,
    occasion,
    minPriceMinor,
    maxPriceMinor,
    sort: (b.sort ?? 'name') as StoreBrowseQuery['sort'],
    page: Number(b.page ?? 1),
    pageSize: Number(b.pageSize ?? 24),
  };
}
