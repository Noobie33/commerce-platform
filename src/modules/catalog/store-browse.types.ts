export interface StoreProductCard {
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
export interface StoreFacet {
  items: { value: string; count: number }[];
  truncated: boolean;
}
export interface StoreBrowseResult {
  items: StoreProductCard[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  currency: 'BDT';
  facets: Record<'size' | 'color' | 'fit', StoreFacet>;
}
