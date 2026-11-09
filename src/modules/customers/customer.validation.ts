import { BadRequestException } from '@nestjs/common';
import type { CustomerAddress, CustomerInput, CreditInput } from './customer.types.js';
export function invalid(message = 'Check customer details'): never {
  throw new BadRequestException({ code: 'INVALID_CUSTOMER_INPUT', message });
}
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid('Unexpected customer fields');
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
export const digits = (s: string) => s.replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 2534));
export function phone(value: unknown): string {
  let s = digits(text(value, 80)).replace(/[\s()\-]/g, '');
  if (/^01\d{9}$/.test(s)) s = '+880' + s.slice(1);
  else if (/^8801\d{9}$/.test(s)) s = '+' + s;
  if (s && !/^\+[1-9]\d{7,14}$/.test(s))
    invalid('Use a local 01… mobile number or full international number with +');
  return s;
}
export function email(value: unknown): string {
  const s = text(value, 160);
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(s)) invalid('Enter a valid email address');
  return s;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    invalid('A valid request or customer ID is required');
  return value.toLowerCase();
}
function version(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 2147483646)
    invalid('Refresh this customer before saving');
  return value as number;
}
function address(value: unknown): CustomerAddress | null {
  if (value === null || value === undefined) return null;
  const b = object(value, ['line1', 'line2', 'area', 'district', 'postalCode']);
  const result = {
    line1: text(b.line1, 240, true),
    line2: text(b.line2, 240),
    area: text(b.area, 100),
    district: text(b.district, 100),
    postalCode: digits(text(b.postalCode, 20)),
  };
  if (result.postalCode && !/^\d{4}$/.test(result.postalCode))
    invalid('Bangladesh postal codes use four digits');
  return result;
}
export function customerInput(value: unknown, editing = false): CustomerInput {
  const b = object(value, [
    'customerKind',
    'segment',
    'name',
    'contactName',
    'phone',
    'email',
    'billingAddress',
    'deliveryAddress',
    'notes',
    'isActive',
    ...(editing ? ['expectedVersion'] : []),
  ]);
  if (
    !['person', 'business'].includes(String(b.customerKind)) ||
    !['retail', 'wholesale', 'both'].includes(String(b.segment)) ||
    typeof b.isActive !== 'boolean'
  )
    invalid();
  return {
    customerKind: b.customerKind as CustomerInput['customerKind'],
    segment: b.segment as CustomerInput['segment'],
    name: text(b.name, 140, true),
    contactName: text(b.contactName, 120),
    phone: phone(b.phone),
    email: email(b.email),
    billingAddress: address(b.billingAddress),
    deliveryAddress: address(b.deliveryAddress),
    notes: text(b.notes, 1000),
    isActive: b.isActive,
    ...(editing ? { expectedVersion: version(b.expectedVersion) } : {}),
  };
}
export function creditInput(value: unknown): CreditInput {
  const b = object(value, [
    'expectedVersion',
    'creditEnabled',
    'creditLimit',
    'paymentTermsDays',
    'reason',
  ]);
  if (
    typeof b.creditEnabled !== 'boolean' ||
    typeof b.creditLimit !== 'string' ||
    !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(b.creditLimit) ||
    !Number.isInteger(b.paymentTermsDays) ||
    Number(b.paymentTermsDays) < 0 ||
    Number(b.paymentTermsDays) > 365
  )
    invalid('Enter a valid BDT credit limit and payment terms of 0–365 days');
  const [whole, fraction = ''] = b.creditLimit.split('.');
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (
    minor > 99999999999999n ||
    (b.creditEnabled && minor === 0n) ||
    (!b.creditEnabled && (minor !== 0n || b.paymentTermsDays !== 0))
  )
    invalid(
      'Enabled credit needs a positive limit; disabled credit must have zero limit and terms',
    );
  return {
    expectedVersion: version(b.expectedVersion),
    creditEnabled: b.creditEnabled,
    creditLimit: minor.toString(),
    paymentTermsDays: b.paymentTermsDays as number,
    reason: text(b.reason, 500, true),
  };
}
export function listQuery(value: unknown) {
  const b = object(value, ['search', 'page', 'status', 'segment', 'kind']);
  const page = b.page === undefined ? 1 : Number(b.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) invalid('Invalid page');
  const status = b.status ?? 'all',
    segment = b.segment ?? 'all',
    kind = b.kind ?? 'all';
  if (
    typeof status !== 'string' ||
    typeof segment !== 'string' ||
    typeof kind !== 'string' ||
    !['all', 'active', 'inactive'].includes(String(status)) ||
    !['all', 'retail', 'wholesale', 'both'].includes(String(segment)) ||
    !['all', 'person', 'business'].includes(String(kind))
  )
    invalid('Invalid customer filter');
  return { search: text(b.search, 140), page, status, segment, kind };
}
export function matchQuery(value: unknown) {
  const b = object(value, ['phone', 'email', 'excludeId']);
  return {
    phone: phone(b.phone),
    email: email(b.email),
    excludeId: b.excludeId === undefined ? null : uuid(b.excludeId),
  };
}
