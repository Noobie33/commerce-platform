import { BadRequestException } from '@nestjs/common';
import type { MerchInput, MerchAssignments } from './merch.types.js';
function invalid(): never {
  throw new BadRequestException({
    code: 'INVALID_MERCH_INPUT',
    message: 'Check the guide or collection fields, measurements and revisions.',
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
function text(v: unknown, max: number, required = true, multiline = false): string {
  if (typeof v !== 'string') invalid();
  const s = v.normalize('NFC').trim();
  if (
    [...s].length > max ||
    (required && !s) ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(
      s,
    )
  )
    invalid();
  return s;
}
function id(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v)) invalid();
  return v.toLowerCase();
}
function version(v: unknown, min = 1): number {
  if (!Number.isInteger(v) || Number(v) < min || Number(v) > 2147483645) invalid();
  return v as number;
}
export function merchAssignments(v: unknown): MerchAssignments {
  const b = obj(v, ['sizeGuide', 'collections']);
  const ref = (v: unknown) => {
    const x = obj(v, ['id', 'version']);
    return { id: id(x.id), version: version(x.version) };
  };
  if (!Array.isArray(b.collections) || b.collections.length > 20) invalid();
  const collections = b.collections.map(ref).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(collections.map((x) => x.id)).size !== collections.length) invalid();
  return { sizeGuide: b.sizeGuide === null ? null : ref(b.sizeGuide), collections };
}
export function merchInput(v: unknown): MerchInput {
  const b = obj(v, ['id', 'kind', 'slug', 'expectedVersion', 'definition', 'reason']);
  if (b.kind !== 'size_guide' && b.kind !== 'collection') invalid();
  const slug = text(b.slug, 120);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) invalid();
  const d = obj(
    b.definition,
    b.kind === 'collection'
      ? ['title', 'active', 'description']
      : ['title', 'active', 'unit', 'basis', 'instructions', 'columns', 'rows'],
  );
  if (typeof d.active !== 'boolean') invalid();
  const base = { title: text(d.title, 120), active: d.active };
  let definition: MerchInput['definition'];
  if (b.kind === 'collection')
    definition = { ...base, description: text(d.description, 1000, false, true) };
  else {
    if (
      !['cm', 'in'].includes(String(d.unit)) ||
      !['garment', 'body'].includes(String(d.basis)) ||
      !Array.isArray(d.columns) ||
      d.columns.length < 1 ||
      d.columns.length > 8 ||
      !Array.isArray(d.rows) ||
      d.rows.length < 1 ||
      d.rows.length > 30
    )
      invalid();
    const columns = d.columns.map((x) => text(x, 40));
    if (new Set(columns.map((x) => x.toLowerCase())).size !== columns.length) invalid();
    const rows = d.rows.map((x) => {
      const r = obj(x, ['size', 'values']);
      if (!Array.isArray(r.values) || r.values.length !== columns.length) invalid();
      return {
        size: text(r.size, 30),
        values: r.values.map((x) => {
          const s = text(x, 7);
          if (!/^(0|[1-9][0-9]{0,3})(\.[0-9]{1,2})?$/.test(s) || Number(s) <= 0) invalid();
          return s;
        }),
      };
    });
    if (new Set(rows.map((x) => x.size.toLowerCase())).size !== rows.length) invalid();
    definition = {
      ...base,
      unit: d.unit as 'cm' | 'in',
      basis: d.basis as 'garment' | 'body',
      instructions: text(d.instructions, 1000, false, true),
      columns,
      rows,
    };
  }
  const result: MerchInput = {
    id: id(b.id),
    kind: b.kind,
    slug,
    expectedVersion: version(b.expectedVersion, 0),
    definition,
    reason: text(b.reason, 500, true, true),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 12500) invalid();
  return result;
}
export function merchQuery(v: unknown) {
  const b = obj(v, ['search', 'kind', 'page', 'status']);
  const search = b.search === undefined ? '' : text(b.search, 100, false);
  const kind = b.kind ?? 'all',
    status = b.status ?? 'all';
  if (
    !['all', 'size_guide', 'collection'].includes(String(kind)) ||
    !['all', 'active'].includes(String(status))
  )
    invalid();
  if (b.page !== undefined && (typeof b.page !== 'string' || !/^[1-9][0-9]{0,5}$/.test(b.page)))
    invalid();
  return {
    search,
    kind: String(kind),
    status: String(status),
    page: b.page === undefined ? 1 : Number(b.page),
  };
}
