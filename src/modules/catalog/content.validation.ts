import { seoInput } from './presentation.validation.js';
import { merchAssignments } from './merch.validation.js';
import { BadRequestException } from '@nestjs/common';
import type { ContentInput } from './content.types.js';
function invalid(): never {
  throw new BadRequestException({
    code: 'INVALID_CONTENT_INPUT',
    message: 'Check product content, field limits and revision before saving.',
  });
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') invalid();
  const s = value.normalize('NFC').trim();
  if ([...s].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)) invalid();
  return s;
}
export function contentInput(value: unknown): ContentInput {
  const b = object(value, [
    'action',
    'expectedVersion',
    'expectedProductVersion',
    'profile',
    'slug',
    'description',
    'specifications',
    'reason',
    'merchandising',
    'seo',
  ]);
  if (
    !['save', 'submit', 'approve', 'request_changes', 'withdraw'].includes(String(b.action)) ||
    !Number.isInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 0 ||
    Number(b.expectedVersion) > 2147483645 ||
    !Number.isInteger(b.expectedProductVersion) ||
    Number(b.expectedProductVersion) < 1 ||
    Number(b.expectedProductVersion) > 2147483646
  )
    invalid();
  const result: ContentInput = {
    action: b.action as ContentInput['action'],
    expectedVersion: b.expectedVersion as number,
    expectedProductVersion: b.expectedProductVersion as number,
  };
  if (result.action === 'save') {
    if ('reason' in b) invalid();
    if ('merchandising' in b) result.merchandising = merchAssignments(b.merchandising);
    if ('seo' in b) result.seo = seoInput(b.seo);
    result.profile = text(b.profile, 60);
    result.slug = text(b.slug, 120);
    result.description = text(b.description, 2000);
    if (
      !/^[a-z][a-z0-9-]{1,59}$/.test(result.profile) ||
      (result.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(result.slug))
    )
      invalid();
    if (
      !b.specifications ||
      typeof b.specifications !== 'object' ||
      Array.isArray(b.specifications) ||
      Object.keys(b.specifications).length > 12
    )
      invalid();
    result.specifications = Object.create(null) as Record<string, string>;
    for (const [key, v] of Object.entries(b.specifications)) {
      if (!/^[a-z][A-Za-z0-9]{0,39}$/.test(key) || ['constructor', 'prototype'].includes(key))
        invalid();
      result.specifications[key] = text(v, 600);
    }
  } else {
    if (
      ['profile', 'slug', 'description', 'specifications', 'merchandising', 'seo'].some(
        (k) => k in b,
      )
    )
      invalid();
    if (result.action === 'submit') {
      if ('reason' in b) invalid();
    } else {
      result.reason = text(b.reason, 500);
      if (!result.reason) invalid();
    }
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 13500) invalid();
  return result;
}
export function contentPage(value: unknown): number {
  const b = object(value, ['page']);
  if (b.page === undefined) return 1;
  if (typeof b.page !== 'string' || !/^([1-9][0-9]{0,5})$/.test(b.page)) invalid();
  return Number(b.page);
}
