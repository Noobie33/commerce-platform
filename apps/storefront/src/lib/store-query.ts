export type SearchValues = Record<string, string | string[] | undefined>;
export const filters = ['size', 'color', 'fit', 'materialGroup', 'occasion'] as const;
const keys = ['q', 'category', ...filters, 'minPrice', 'maxPrice', 'sort', 'page'];
export class StoreQueryError extends Error {}
export function shopQuery(input: SearchValues) {
  if (
    Object.keys(input).some((k) => !keys.includes(k)) ||
    Object.values(input).some((v) => v !== undefined && typeof v !== 'string')
  )
    throw new StoreQueryError('Use one value for each search or filter.');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const s = v.normalize('NFC').trim();
    if (s.length > 120 || /[\u0000-\u001f\u007f]/u.test(s))
      throw new StoreQueryError('Check the search and filter values.');
    out[k] = s;
  }
  if ((out.q?.length ?? 0) > 80) throw new StoreQueryError('Keep search within 80 characters.');
  if (out.category && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(out.category))
    throw new StoreQueryError('Choose a product category.');
  if (out.sort && !['name', 'price_asc', 'price_desc'].includes(out.sort))
    throw new StoreQueryError('Choose a supported sort order.');
  if (out.page && (!/^[1-9][0-9]{0,3}$/.test(out.page) || Number(out.page) > 1000))
    throw new StoreQueryError('Choose a valid page.');
  const api = new URLSearchParams();
  for (const [k, v] of Object.entries(out)) {
    if (k === 'minPrice' || k === 'maxPrice') {
      if (!/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(v))
        throw new StoreQueryError('Enter prices in taka, for example 1290.00.');
      const [a, b = ''] = v.split('.');
      api.set(k + 'Minor', (BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'))).toString());
    } else api.set(k, v);
  }
  if (
    api.has('minPriceMinor') &&
    api.has('maxPriceMinor') &&
    BigInt(api.get('minPriceMinor')!) > BigInt(api.get('maxPriceMinor')!)
  )
    throw new StoreQueryError('Minimum price must not exceed maximum price.');
  api.set('pageSize', '24');
  return { values: out, api: api.toString() };
}
export function shopLink(
  values: Record<string, string>,
  changes: Record<string, string | null> = {},
) {
  const p = new URLSearchParams(values);
  for (const [k, v] of Object.entries(changes))
    if (v === null || v === '') p.delete(k);
    else p.set(k, v);
  const q = p.toString();
  return '/shop' + (q ? '?' + q : '');
}
export function apiOrigin(raw = 'http://127.0.0.1:4000') {
  const u = new URL(raw);
  if (
    u.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw Error('Store API must be the configured loopback HTTP origin');
  return u.origin;
}
export function mediaTarget(parts: string[]) {
  const id = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}',
    path = parts.join('/');
  if (new RegExp('^photos/' + id + '/(image|thumbnail)$').test(path))
    return {
      path: '/api/v1/store/' + path,
      max: 16 * 1024 * 1024,
      type: 'image/webp',
      range: false,
    };
  if (
    new RegExp(
      '^products/[a-z0-9]+(-[a-z0-9]+)*/media/[1-9][0-9]{0,9}/' + id + '/(playback|poster)$',
    ).test(path) &&
    parts[1]!.length <= 120 &&
    Number(parts[3]) <= 2147483646
  )
    return {
      path: '/api/v1/store/' + path,
      max: path.endsWith('/poster') ? 1048576 : 83886080,
      type: path.endsWith('/poster') ? 'image/webp' : 'video/mp4',
      range: path.endsWith('/playback'),
    };
  return null;
}
