export const SAVED_KEY = 'commerce.store.saved.v1';
export const SAVED_LIMIT = 50;
const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function resolveInput(value: unknown): string[] {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => k !== 'productIds')
  )
    throw Error('Invalid saved list');
  const ids = (value as { productIds: unknown }).productIds;
  if (
    !Array.isArray(ids) ||
    ids.length > SAVED_LIMIT ||
    ids.some((x) => typeof x !== 'string' || !idPattern.test(x)) ||
    new Set(ids).size !== ids.length
  )
    throw Error('Invalid saved list');
  return [...ids] as string[];
}
export function readSaved(raw: string | null): string[] {
  if (raw === null) return [];
  if (raw.length > 8192) throw Error('Invalid saved storage');
  const v = JSON.parse(raw) as Record<string, unknown>;
  if (
    !v ||
    Array.isArray(v) ||
    v.version !== 1 ||
    Object.keys(v).some((k) => !['version', 'productIds'].includes(k))
  )
    throw Error('Invalid saved storage');
  return resolveInput({ productIds: v.productIds });
}
export function writeSaved(ids: string[]): string {
  return JSON.stringify({ version: 1, productIds: resolveInput({ productIds: ids }) });
}
export function updateSaved(ids: string[], id: string, wanted: boolean) {
  resolveInput({ productIds: ids });
  if (!idPattern.test(id)) throw Error('Invalid product');
  if (wanted && ids.includes(id)) return { ids, full: false };
  if (wanted && ids.length >= SAVED_LIMIT) return { ids, full: true };
  return { ids: wanted ? [id, ...ids] : ids.filter((x) => x !== id), full: false };
}
