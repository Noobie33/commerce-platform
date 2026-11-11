export interface Category {
  id: string;
  slug: string;
  name: string;
  parentSlug: string | null;
}
export interface Facet {
  items: { value: string; count: number }[];
  truncated: boolean;
}
export interface Card {
  productId: string;
  slug: string;
  name: string;
  styleCode: string;
  currency: 'BDT';
  releaseVersion: number;
  matchingVariantCount: number;
  matchingPriceMinMinor: string;
  matchingPriceMaxMinor: string;
  photo: { id: string; alt: string; width: number; height: number; thumbnailUrl: string };
}
export interface Browse {
  items: Card[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  currency: 'BDT';
  facets: Record<'size' | 'color' | 'fit' | 'materialGroup' | 'occasion', Facet>;
}
export interface Media {
  kind: 'photo' | 'video';
  id: string;
  label: string;
  width: number;
  height: number;
  url: string;
  thumbnailUrl: string;
  variantId: string | null;
  hasAudio: boolean;
  durationSeconds: number | null;
}
export interface Variant {
  id: string;
  sku: string;
  priceMinor: string;
  attributes: Record<string, string>;
}
export interface Product {
  productId: string;
  slug: string;
  name: string;
  styleCode: string;
  currency: 'BDT';
  description: string;
  specifications: Record<string, string>;
  variants: Variant[];
  gallery: Media[];
  categoryPath: { id: string; slug: string; name: string }[];
  releaseVersion: number;
  seo: { title: string; description: string };
}
const fail = (): never => {
  throw Error('Invalid public catalog response');
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail();
const text = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : fail());
const list = (v: unknown, max = 500) => (Array.isArray(v) && v.length <= max ? v : fail());
const num = (v: unknown, min = 0, max = 2147483646) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fail();
const uuid = (v: unknown) => {
  const s = text(v, 36);
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s) ? s : fail();
};
export const slugValue = (v: unknown) => {
  const s = text(v, 120);
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) ? s : fail();
};
export const moneyValue = (v: unknown) => {
  const s = text(v, 12);
  return /^(0|[1-9][0-9]{0,11})$/.test(s) ? s : fail();
};
const bool = (v: unknown) => (typeof v === 'boolean' ? v : fail());
const fields = (v: unknown) => {
  const r = record(v);
  if (Object.keys(r).length > 60) fail();
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [text(k, 80), text(v, 1200)]));
};
const bdt = (v: unknown): 'BDT' => (v === 'BDT' ? 'BDT' : fail());
const dimension = (v: unknown) => num(v, 1, 4096);
export function photoLink(id: string, size: 'image' | 'thumbnail') {
  return '/media/photos/' + uuid(id) + '/' + size;
}
export function parseNavigation(v: unknown): Category[] {
  return list(record(v).items, 200).map((x) => {
    const r = record(x);
    return {
      id: uuid(r.id),
      slug: slugValue(r.slug),
      name: text(r.name),
      parentSlug: r.parentSlug === null ? null : slugValue(r.parentSlug),
    };
  });
}
export function parseBrowse(v: unknown): Browse {
  const r = record(v),
    facets = record(r.facets),
    out = {} as Browse['facets'];
  for (const k of ['size', 'color', 'fit', 'materialGroup', 'occasion'] as const) {
    const f = record(facets[k]);
    out[k] = {
      items: list(f.items, 100).map((v) => {
        const x = record(v);
        return { value: text(x.value, 120), count: num(x.count) };
      }),
      truncated: bool(f.truncated),
    };
  }
  return {
    currency: bdt(r.currency),
    total: num(r.total),
    page: num(r.page, 1, 1000),
    pageSize: num(r.pageSize, 1, 48),
    hasMore: bool(r.hasMore),
    facets: out,
    items: list(r.items, 48).map((v) => {
      const x = record(v),
        p = record(x.photo),
        id = uuid(p.id),
        expected = '/api/v1/store/photos/' + id + '/thumbnail';
      if (p.thumbnailUrl !== expected) fail();
      return {
        productId: uuid(x.productId),
        slug: slugValue(x.slug),
        name: text(x.name),
        styleCode: text(x.styleCode, 80),
        currency: bdt(x.currency),
        releaseVersion: num(x.releaseVersion, 1),
        matchingVariantCount: num(x.matchingVariantCount, 1),
        matchingPriceMinMinor: moneyValue(x.matchingPriceMinMinor),
        matchingPriceMaxMinor: moneyValue(x.matchingPriceMaxMinor),
        photo: {
          id,
          alt: text(p.alt, 240),
          width: dimension(p.width),
          height: dimension(p.height),
          thumbnailUrl: photoLink(id, 'thumbnail'),
        },
      };
    }),
  };
}
export function parseProduct(v: unknown): Product {
  const r = record(v),
    slug = slugValue(r.slug),
    version = num(r.releaseVersion, 1),
    seo = record(r.seo ?? {});
  return {
    productId: uuid(r.productId),
    slug,
    name: text(r.name),
    styleCode: text(r.styleCode, 80),
    currency: bdt(r.currency),
    description: text(r.description, 10000),
    specifications: fields(r.specifications),
    releaseVersion: version,
    seo: {
      title: seo.title === undefined ? '' : text(seo.title, 200),
      description: seo.description === undefined ? '' : text(seo.description, 400),
    },
    categoryPath: list(r.categoryPath, 12).map((v) => {
      const x = record(v);
      return { id: uuid(x.id), slug: slugValue(x.slug), name: text(x.name) };
    }),
    variants: list(r.variants, 500).map((v) => {
      const x = record(v);
      return {
        id: uuid(x.id),
        sku: text(x.sku, 80),
        priceMinor: moneyValue(x.priceMinor),
        attributes: fields(x.attributes),
      };
    }),
    gallery: list(r.gallery, 100).map((v) => {
      const m = record(v),
        kind = m.kind === 'photo' ? 'photo' : m.kind === 'video' ? 'video' : fail(),
        id = uuid(m.id),
        prefix =
          kind === 'photo'
            ? '/api/v1/store/photos/' + id
            : '/api/v1/store/products/' + slug + '/media/' + version + '/' + id,
        url = prefix + (kind === 'photo' ? '/image' : '/playback'),
        thumbnailUrl = prefix + (kind === 'photo' ? '/thumbnail' : '/poster');
      if (m.url !== url || m.thumbnailUrl !== thumbnailUrl) fail();
      return {
        kind,
        id,
        label: text(m.label, 240),
        width: dimension(m.width),
        height: dimension(m.height),
        url: url.replace('/api/v1/store', '/media'),
        thumbnailUrl: thumbnailUrl.replace('/api/v1/store', '/media'),
        variantId: m.variantId === undefined || m.variantId === null ? null : uuid(m.variantId),
        hasAudio: kind === 'video' ? bool(m.hasAudio) : false,
        durationSeconds:
          kind === 'video' &&
          typeof m.durationSeconds === 'number' &&
          m.durationSeconds > 0 &&
          m.durationSeconds <= 300
            ? m.durationSeconds
            : null,
      };
    }),
  };
}
export function money(minor: string) {
  const n = BigInt(moneyValue(minor));
  return (
    String.fromCharCode(0x09f3) +
    ' ' +
    new Intl.NumberFormat('en-BD').format(n / 100n) +
    '.' +
    (n % 100n).toString().padStart(2, '0')
  );
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(
    /[<>&]/g,
    (c) => String.fromCharCode(92) + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

export function productSelection(
  p: Product,
  query: Record<string, unknown>,
): Record<string, string> {
  const selection: Record<string, string> = {};
  for (const key of ['color', 'size']) {
    const v = query[key];
    if (typeof v !== 'string' || v.length > 60) continue;
    const match = p.variants
      .map((x) => x.attributes[key])
      .find((x) => x?.normalize('NFKC').toLowerCase() === v.normalize('NFKC').toLowerCase());
    if (match) selection[key] = match;
  }
  return p.variants.some((v) =>
    Object.entries(selection).every(([k, value]) => v.attributes[k] === value),
  )
    ? selection
    : {};
}
