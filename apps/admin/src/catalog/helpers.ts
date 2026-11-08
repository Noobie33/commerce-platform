import type { Category, VariantDraft } from './types';
export const newVariant = (): VariantDraft => ({
  key: crypto.randomUUID(),
  sku: '',
  attributes: {},
  barcode: '',
  price: '',
  isActive: true,
});
export function money(value: string | null): string {
  if (value === null) return '—';
  const [major, fraction = '00'] = value.split('.');
  return '৳ ' + BigInt(major!).toLocaleString('en-BD') + '.' + fraction.padEnd(2, '0');
}
export function categoryName(id: string | null, categories: Category[]): string {
  if (!id) return 'Uncategorised';
  const parts: string[] = [],
    seen = new Set<string>();
  let current = categories.find((row) => row.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = categories.find((row) => row.id === current!.parentId);
  }
  return parts.join(' / ') || 'Uncategorised';
}
export function combinations(
  style: string,
  sizes: string,
  colours: string,
  price: string,
): VariantDraft[] {
  const unique = (value: string) => [
    ...new Map(
      value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => [value.normalize('NFKC').toLowerCase(), value]),
    ).values(),
  ];
  const s = unique(sizes),
    c = unique(colours);
  if (!s.length && !c.length) throw new Error('Enter at least one size or colour.');
  if ((s.length || 1) * (c.length || 1) > 50)
    throw new Error('This editor supports up to 50 SKUs at a time.');
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(style.toUpperCase().trim()))
    throw new Error('Enter a valid style code first.');
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(price))
    throw new Error('Enter a default retail price, for example 1250.00.');
  const used = new Set<string>();
  return (s.length ? s : ['']).flatMap((size) =>
    (c.length ? c : ['']).map((colour, index) => {
      const piece = (value: string) =>
        value
          .normalize('NFKD')
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 9);
      const base = [
        style.toUpperCase().trim(),
        ...(size ? [piece(size) || 'SIZE'] : []),
        ...(colour ? [piece(colour) || 'COLOUR'] : []),
      ]
        .join('-')
        .slice(0, 60);
      let sku = base.length >= 3 ? base : base + '-01',
        i = index + 1;
      while (used.has(sku)) sku = base + '-' + ++i;
      used.add(sku);
      return {
        ...newVariant(),
        sku,
        attributes: { ...(size ? { size } : {}), ...(colour ? { colour } : {}) },
        price,
      };
    }),
  );
}
