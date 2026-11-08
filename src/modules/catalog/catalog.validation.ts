import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CatalogQuery, ProductInput, ProductStatus, VariantInput } from './catalog.types.js';

export function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_CATALOG_INPUT', message });
}
export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    invalid('Invalid ' + field);
  return value.toLowerCase();
}
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Invalid catalog request');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !allowed.includes(key)))
    invalid('Unexpected catalog field');
  return result;
}
function text(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') invalid(name + ' is required');
  const result = value.normalize('NFC').trim();
  if (
    (!allowEmpty && !result) ||
    [...result].length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)
  )
    invalid('Invalid ' + name);
  return result;
}
export function fold(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}
export function priceMinor(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    invalid('Price must be a BDT amount with at most two decimal places');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
export function decimal(minor: string): string {
  const amount = BigInt(minor);
  return (amount / 100n).toString() + '.' + (amount % 100n).toString().padStart(2, '0');
}
function variant(value: unknown): VariantInput {
  const row = object(value, ['id', 'sku', 'attributes', 'barcode', 'price', 'isActive']);
  const sku = text(row.sku, 'SKU', 64).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(sku))
    invalid('SKU must have 3–64 letters, numbers, dots, underscores or hyphens');
  if (!row.attributes || typeof row.attributes !== 'object' || Array.isArray(row.attributes))
    invalid('Variant attributes must be an object');
  const entries = Object.entries(row.attributes);
  if (entries.length > 6) invalid('A variant supports up to six attributes');
  const attributes: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    const name = fold(text(key, 'attribute name', 24));
    if (['__proto__', 'prototype', 'constructor'].includes(name) || name in attributes)
      invalid('Invalid or duplicate attribute name');
    if ([...name].length > 24) invalid('Attribute name is too long');
    attributes[name] = text(value, 'attribute value', 60);
  }
  const sorted = Object.fromEntries(
    Object.entries(attributes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const canonical = Object.entries(sorted).map(([key, value]) => [key, fold(value)]);
  const optionsKey = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  const barcode =
    row.barcode === undefined || row.barcode === null || row.barcode === ''
      ? null
      : text(row.barcode, 'barcode', 64);
  if (barcode && !/^[!-~]{1,64}$/.test(barcode))
    invalid('Barcode must contain 1–64 printable characters without spaces');
  if (typeof row.isActive !== 'boolean') invalid('Variant active status is required');
  return {
    ...(row.id !== undefined ? { id: uuid(row.id, 'variant id') } : {}),
    sku,
    attributes: sorted,
    optionsKey,
    barcode,
    priceMinor: priceMinor(row.price),
    isActive: row.isActive,
  };
}
export function productInput(value: unknown, editing: boolean): ProductInput {
  const row = object(value, [
    'styleCode',
    'name',
    'description',
    'categoryId',
    'status',
    'currency',
    'variants',
    'expectedVersion',
  ]);
  const styleCode = text(row.styleCode, 'style code', 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(styleCode)) invalid('Invalid style code');
  if (!['draft', 'active', 'archived'].includes(String(row.status)))
    invalid('Invalid product status');
  if (row.currency !== 'BDT') invalid('This catalog currently uses BDT');
  if (!Array.isArray(row.variants) || row.variants.length < 1 || row.variants.length > 50)
    invalid('Include between 1 and 50 variants');
  const variants = row.variants
    .map(variant)
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  const skus = new Set<string>(),
    options = new Set<string>(),
    ids = new Set<string>(),
    barcodes = new Set<string>();
  for (const item of variants) {
    if (skus.has(item.sku)) invalid('Duplicate SKU in this product');
    skus.add(item.sku);
    if (item.id) {
      if (!editing || ids.has(item.id)) invalid('Invalid or duplicate existing variant');
      ids.add(item.id);
    }
    if (item.isActive) {
      if (options.has(item.optionsKey)) invalid('Active variants must have distinct attributes');
      options.add(item.optionsKey);
    }
    if (item.barcode) {
      if (barcodes.has(item.barcode)) invalid('Duplicate barcode in this product');
      barcodes.add(item.barcode);
    }
  }
  if (row.status === 'active' && !variants.some((item) => item.isActive))
    invalid('An active product needs an active variant');
  if (editing && (!Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion) < 1))
    invalid('The current product version is required');
  if (!editing && row.expectedVersion !== undefined) invalid('A new product cannot have a version');
  return {
    styleCode,
    name: text(row.name, 'product name', 140),
    description: text(row.description ?? '', 'description', 2000, true),
    categoryId:
      row.categoryId === null || row.categoryId === undefined || row.categoryId === ''
        ? null
        : uuid(row.categoryId, 'category'),
    status: row.status as ProductStatus,
    currency: 'BDT',
    variants,
    ...(editing ? { expectedVersion: Number(row.expectedVersion) } : {}),
  };
}
export function categoryInput(value: unknown) {
  const row = object(value, ['name', 'parentId']);
  const name = text(row.name, 'category name', 80),
    nameKey = fold(name);
  if ([...nameKey].length > 120) invalid('Category name is too long');
  return {
    name,
    nameKey,
    parentId:
      row.parentId === null || row.parentId === undefined || row.parentId === ''
        ? null
        : uuid(row.parentId, 'parent category'),
  };
}
export function catalogQuery(value: unknown): CatalogQuery {
  const row = object(value, ['search', 'status', 'categoryId', 'page', 'pageSize']);
  const number = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max)
      invalid('Invalid page');
    return Number(value);
  };
  const status = row.status === undefined ? 'all' : String(row.status);
  if (!['all', 'draft', 'active', 'archived'].includes(status)) invalid('Invalid status filter');
  return {
    search: row.search === undefined ? '' : text(row.search, 'search', 100, true),
    status: status as CatalogQuery['status'],
    categoryId:
      row.categoryId === undefined || row.categoryId === ''
        ? null
        : uuid(row.categoryId, 'category'),
    page: number(row.page, 1, 10000),
    pageSize: number(row.pageSize, 20, 50),
  };
}
