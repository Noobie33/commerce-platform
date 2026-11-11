import 'server-only';
import { cache } from 'react';
import { apiOrigin } from './store-query';
import {
  parseBrowse,
  parseNavigation,
  parseProduct,
  parseRelated,
  parseSavedCards,
  slugValue,
} from './catalog-contract';
export class CatalogError extends Error {
  constructor(readonly status: number) {
    super('Catalog is currently unavailable');
  }
}
export function storeSettings() {
  const name = (process.env.STORE_BRAND_NAME ?? 'Your brand').normalize('NFC').trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name))
    throw Error('Invalid public brand name');
  return {
    brand: name,
    origin: apiOrigin(process.env.STORE_API_ORIGIN),
    site: apiOrigin(process.env.STORE_SITE_ORIGIN ?? 'http://127.0.0.1:3000'),
  };
}
async function json(path: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch(storeSettings().origin + path, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
  } catch {
    throw new CatalogError(503);
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new CatalogError(r.status);
  if (
    !r.headers.get('content-type')?.startsWith('application/json') ||
    r.headers.get('content-encoding')
  )
    throw new CatalogError(502);
  const reader = r.body?.getReader();
  if (!reader) throw new CatalogError(502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2097152) {
        await reader.cancel();
        throw new CatalogError(502);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(out));
  } catch {
    throw new CatalogError(502);
  } finally {
    reader.releaseLock();
  }
}
export const getNavigation = cache(async () => {
  try {
    return parseNavigation(await json('/api/v1/store/navigation'));
  } catch {
    return [];
  }
});
export const getBrowse = cache(async (query: string) => {
  const raw = await json('/api/v1/store/products?' + query);
  if (raw === null) throw new CatalogError(503);
  try {
    return parseBrowse(raw);
  } catch {
    throw new CatalogError(502);
  }
});
export const getProduct = cache(async (slug: string) => {
  try {
    slugValue(slug);
  } catch {
    return null;
  }
  const raw = await json('/api/v1/store/products/' + slug);
  if (raw === null) return null;
  try {
    const p = parseProduct(raw);
    if (!p.gallery.length || !p.variants.length) throw Error('Incomplete product');
    return p;
  } catch {
    throw new CatalogError(502);
  }
});

export const getRelated = cache(async (slug: string) => {
  try {
    slugValue(slug);
    const r = await json('/api/v1/store/products/' + slug + '/related');
    return r === null ? [] : parseRelated(r);
  } catch {
    return [];
  }
});

export async function resolveSaved(ids: string[]) {
  if (!ids.length) return [];
  const r = await json('/api/v1/store/saved-products/resolve', { productIds: ids });
  if (r === null) throw new CatalogError(503);
  return parseSavedCards(r, ids);
}
