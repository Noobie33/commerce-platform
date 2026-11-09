import { BadRequestException } from '@nestjs/common';
import type { SalesInput } from './sales.types.js';
export function invalid(message = 'Check sales order details'): never {
  throw new BadRequestException({ code: 'INVALID_SALES_INPUT', message });
}
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid('Unexpected sales fields');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') invalid();
  const s = value.normalize('NFC').trim();
  if (
    s.length > max ||
    (required && !s) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)
  )
    invalid();
  return s;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    invalid('A valid record or request ID is required');
  return value.toLowerCase();
}
export function version(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 2147483646)
    invalid('Refresh before saving this record');
  return value as number;
}
export function minor(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value))
    invalid('Enter a non-negative BDT price with up to two decimals');
  const [a, b = ''] = value.split('.');
  const n = BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'));
  if (n > 999999999999n) invalid('Unit price is too large');
  return n.toString();
}
export function decimal(value: string | bigint): string {
  const n = BigInt(value);
  return n / 100n + '.' + (n % 100n).toString().padStart(2, '0');
}
export function salesInput(value: unknown, editing = false): SalesInput {
  const b = object(value, [
    'customerId',
    'customerVersion',
    'locationId',
    'channel',
    'fulfillOn',
    'reference',
    'notes',
    'priceReason',
    'lines',
    ...(editing ? ['expectedVersion'] : []),
  ]);
  if (b.channel !== 'retail' && b.channel !== 'wholesale') invalid('Choose retail or wholesale');
  let fulfillOn: string | null = null;
  if (b.fulfillOn !== undefined && b.fulfillOn !== null && b.fulfillOn !== '') {
    const d = text(b.fulfillOn, 10, true);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
      d < '2000-01-01' ||
      d > '2100-12-31' ||
      !Number.isFinite(Date.parse(d)) ||
      new Date(d).toISOString().slice(0, 10) !== d
    )
      invalid('Choose a valid requested fulfillment date');
    fulfillOn = d;
  }
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > 30)
    invalid('Add 1–30 different product variants');
  const seen = new Set<string>();
  let total = 0n;
  const lines = b.lines.map((v) => {
    const l = object(v, ['variantId', 'quantity', 'unitPrice', 'priceMode']);
    const variantId = uuid(l.variantId);
    if (seen.has(variantId)) invalid('Each variant may appear once');
    seen.add(variantId);
    if (typeof l.quantity !== 'string' || !/^[1-9]\d{0,8}$/.test(l.quantity))
      invalid('Quantity must be a whole number from 1 to 999,999,999');
    if (l.priceMode !== 'catalog' && l.priceMode !== 'override') invalid('Choose a price mode');
    const unitPrice = minor(l.unitPrice);
    total += BigInt(l.quantity) * BigInt(unitPrice);
    if (total > 99999999999999n) invalid('Order total is too large');
    return {
      variantId,
      quantity: l.quantity,
      unitPrice,
      priceMode: l.priceMode as 'catalog' | 'override',
    };
  });
  const priceReason = text(
    b.priceReason,
    500,
    lines.some((l) => l.priceMode === 'override'),
  );
  return {
    customerId: uuid(b.customerId),
    customerVersion: version(b.customerVersion),
    locationId: uuid(b.locationId),
    channel: b.channel,
    fulfillOn,
    reference: text(b.reference, 100),
    notes: text(b.notes, 1000),
    priceReason: lines.some((l) => l.priceMode === 'override') ? priceReason : '',
    lines,
    ...(editing ? { expectedVersion: version(b.expectedVersion) } : {}),
  };
}
export function listQuery(value: unknown) {
  const b = object(value, ['search', 'page', 'status', 'channel']);
  if (b.page !== undefined && (typeof b.page !== 'string' || !/^[1-9]\d{0,5}$/.test(b.page)))
    invalid('Invalid page');
  const status = b.status ?? 'all',
    channel = b.channel ?? 'all';
  if (
    !['all', 'draft', 'cancelled'].includes(status as string) ||
    !['all', 'retail', 'wholesale'].includes(channel as string)
  )
    invalid('Invalid sales filter');
  return {
    search: text(b.search, 140),
    page: b.page === undefined ? 1 : Number(b.page),
    status,
    channel,
  };
}
export function lookupQuery(value: unknown) {
  const b = object(value, ['search']);
  return text(b.search, 140);
}
export function cancelInput(value: unknown) {
  const b = object(value, ['expectedVersion', 'reason']);
  return { expectedVersion: version(b.expectedVersion), reason: text(b.reason, 500, true) };
}
export const escaped = (s: string) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
