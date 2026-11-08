import { BadRequestException } from '@nestjs/common';
import type { OrderInput, SupplierInput, PageQuery } from './purchasing.types.js';
export function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_PURCHASING_INPUT', message });
}
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Invalid purchasing request');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((k) => !keys.includes(k))) invalid('Unexpected purchasing field');
  return row;
}
export function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string') invalid(label + ' is required');
  const s = value.normalize('NFC').trim();
  if (
    (!empty && !s) ||
    [...s].length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)
  )
    invalid('Invalid ' + label);
  return s;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    invalid('Invalid record identifier');
  return value.toLowerCase();
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2147483646)
    invalid('Reload the latest version');
  return Number(value);
}
export function money(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))
    invalid('Use a non-negative BDT cost with up to 2 decimal places');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > 999999999999n) invalid('Unit cost is too large');
  return decimal(minor);
}
export function minor(value: string): bigint {
  const [a, b = ''] = value.split('.');
  return BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'));
}
export function decimal(value: string | bigint): string {
  const n = BigInt(value);
  return n / 100n + '.' + (n % 100n).toString().padStart(2, '0');
}
export function supplierInput(value: unknown, editing = false): SupplierInput {
  const row = object(value, [
    'code',
    'name',
    'contactName',
    'phone',
    'email',
    'address',
    'taxReference',
    'notes',
    'isActive',
    ...(editing ? ['expectedVersion'] : []),
  ]);
  const code = text(row.code, 'supplier code', 32).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,31}$/.test(code)) invalid('Use a 2–32 character supplier code');
  if (typeof row.isActive !== 'boolean') invalid('Choose supplier status');
  const email = text(row.email ?? '', 'email', 160, true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Check the email address');
  return {
    code,
    name: text(row.name, 'supplier name', 140),
    contactName: text(row.contactName ?? '', 'contact name', 120, true),
    phone: text(row.phone ?? '', 'phone', 50, true),
    email,
    address: text(row.address ?? '', 'address', 1000, true),
    taxReference: text(row.taxReference ?? '', 'tax reference', 80, true),
    notes: text(row.notes ?? '', 'notes', 1000, true),
    isActive: row.isActive,
    ...(editing ? { expectedVersion: version(row.expectedVersion) } : {}),
  };
}
export function orderInput(value: unknown, editing = false): OrderInput {
  const row = object(value, [
    'supplierId',
    'locationId',
    'expectedOn',
    'reference',
    'notes',
    'lines',
    ...(editing ? ['expectedVersion'] : []),
  ]);
  let expectedOn: string | null = null;
  if (row.expectedOn !== null && row.expectedOn !== undefined && row.expectedOn !== '') {
    if (
      typeof row.expectedOn !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.expectedOn) ||
      row.expectedOn < '2000-01-01' ||
      row.expectedOn > '2199-12-31' ||
      !Number.isFinite(new Date(row.expectedOn + 'T00:00:00Z').getTime()) ||
      new Date(row.expectedOn + 'T00:00:00Z').toISOString().slice(0, 10) !== row.expectedOn
    )
      invalid('Choose a valid expected delivery date');
    expectedOn = row.expectedOn;
  }
  if (!Array.isArray(row.lines) || row.lines.length < 1 || row.lines.length > 25)
    invalid('Include 1–25 distinct SKUs');
  const seen = new Set<string>();
  let total = 0n;
  const lines = row.lines
    .map((value) => {
      const line = object(value, ['variantId', 'quantity', 'unitCost']),
        variantId = uuid(line.variantId);
      if (seen.has(variantId)) invalid('Include each SKU once');
      seen.add(variantId);
      if (typeof line.quantity !== 'string' || !/^[1-9]\d{0,8}$/.test(line.quantity))
        invalid('Use a positive whole-piece quantity');
      const unitCost = money(line.unitCost);
      total += BigInt(line.quantity) * minor(unitCost);
      if (total > 99999999999999n) invalid('Purchase order total is too large');
      return { variantId, quantity: line.quantity, unitCost };
    })
    .sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
  return {
    supplierId: uuid(row.supplierId),
    locationId: uuid(row.locationId),
    expectedOn,
    reference: text(row.reference ?? '', 'reference', 100, true),
    notes: text(row.notes ?? '', 'notes', 1000, true),
    lines,
    ...(editing ? { expectedVersion: version(row.expectedVersion) } : {}),
  };
}
export function actionInput(value: unknown, cancel = false) {
  const row = object(value, ['expectedVersion', ...(cancel ? ['reason'] : [])]);
  return {
    expectedVersion: version(row.expectedVersion),
    reason: cancel ? text(row.reason, 'cancellation reason', 500) : '',
  };
}
export function pageQuery(value: unknown, orders = false): PageQuery {
  const row = object(value, ['search', 'status', 'page']);
  const status = row.status ?? 'all';
  if (
    !(orders ? ['all', 'draft', 'issued', 'cancelled'] : ['all', 'active', 'inactive']).includes(
      String(status),
    )
  )
    invalid('Invalid status filter');
  if (
    row.page !== undefined &&
    (typeof row.page !== 'string' || !/^[1-9]\d*$/.test(row.page) || Number(row.page) > 10000)
  )
    invalid('Invalid page');
  return {
    search: text(row.search ?? '', 'search', 100, true),
    status: String(status),
    page: Number(row.page ?? 1),
  };
}
export function searchInput(value: unknown): string {
  const row = object(value, ['search']);
  return text(row.search ?? '', 'search', 100, true);
}
