import { BadRequestException } from '@nestjs/common';
import type { InventoryQuery, StockInput, ReversalInput } from './inventory.types.js';
export function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_INVENTORY_INPUT', message });
}
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Invalid inventory request');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key))) invalid('Unexpected inventory field');
  return row;
}
export function uuid(value: unknown, label = 'record'): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    invalid('Invalid ' + label);
  return value.toLowerCase();
}
function text(value: unknown, label: string, max: number, empty = false): string {
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
export function stockInput(value: unknown): StockInput {
  const row = object(value, [
    'kind',
    'locationId',
    'destinationId',
    'reason',
    'reference',
    'lines',
  ]);
  if (!['opening', 'receipt', 'adjustment', 'transfer'].includes(String(row.kind)))
    invalid('Choose a stock action');
  const kind = row.kind as StockInput['kind'],
    locationId = uuid(row.locationId, 'location'),
    destinationId =
      row.destinationId === null || row.destinationId === undefined || row.destinationId === ''
        ? null
        : uuid(row.destinationId, 'destination');
  if (kind === 'transfer' && (!destinationId || destinationId === locationId))
    invalid('Choose a different destination location');
  if (kind !== 'transfer' && destinationId) invalid('This action has one location');
  if (!Array.isArray(row.lines) || row.lines.length < 1 || row.lines.length > 25)
    invalid('Include 1–25 SKUs');
  const seen = new Set<string>(),
    lines = row.lines
      .map((value) => {
        const line = object(value, ['variantId', 'quantity']),
          variantId = uuid(line.variantId, 'SKU');
        if (seen.has(variantId)) invalid('Include each SKU once');
        seen.add(variantId);
        if (
          typeof line.quantity !== 'string' ||
          !/^-?[1-9]\d{0,8}$/.test(line.quantity) ||
          (kind !== 'adjustment' && line.quantity.startsWith('-'))
        )
          invalid('Use a non-zero whole-piece quantity, up to 999999999');
        return { variantId, quantity: line.quantity };
      })
      .sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
  return {
    kind,
    locationId,
    destinationId,
    reason: text(row.reason, 'reason', 500),
    reference: text(row.reference ?? '', 'reference', 100, true),
    lines,
  };
}
export function reversalInput(id: unknown, value: unknown): ReversalInput {
  const row = object(value, ['reason', 'reference']);
  return {
    kind: 'reversal',
    reversalOf: uuid(id, 'posting'),
    reason: text(row.reason, 'reason', 500),
    reference: text(row.reference ?? '', 'reference', 100, true),
  };
}
export function locationInput(value: unknown) {
  const row = object(value, ['code', 'name', 'kind']),
    code = text(row.code, 'location code', 32).toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) invalid('Use a 2–32 character location code');
  if (!['warehouse', 'store'].includes(String(row.kind))) invalid('Choose warehouse or store');
  return {
    code,
    name: text(row.name, 'location name', 120),
    kind: row.kind as 'warehouse' | 'store',
  };
}
export function inventoryQuery(value: unknown, history = false): InventoryQuery {
  const row = object(
    value,
    history ? ['search', 'page', 'pageSize', 'variantId'] : ['search', 'page', 'pageSize', 'stock'],
  );
  const positive = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max)
      invalid('Invalid page');
    return Number(value);
  };
  const stock = row.stock ?? 'all';
  if (!['all', 'positive', 'zero'].includes(String(stock))) invalid('Invalid stock filter');
  return {
    search: text(row.search ?? '', 'search', 100, true),
    page: positive(row.page, 1, 10000),
    pageSize: positive(row.pageSize, 20, 50),
    stock: stock as InventoryQuery['stock'],
    variantId: row.variantId ? uuid(row.variantId, 'SKU') : null,
  };
}
export function variantSearch(value: unknown): string {
  const row = object(value, ['search']);
  return text(row.search ?? '', 'search', 100, true);
}
