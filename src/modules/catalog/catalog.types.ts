export type ProductStatus = 'draft' | 'active' | 'archived';
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
}
export interface Variant {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  barcode: string | null;
  price: string;
  isActive: boolean;
}
export interface Product {
  id: string;
  styleCode: string;
  name: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  status: ProductStatus;
  currency: 'BDT';
  version: number;
  createdAt: string;
  updatedAt: string;
  variants: Variant[];
}
export interface ProductSummary {
  id: string;
  styleCode: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  status: ProductStatus;
  currency: 'BDT';
  version: number;
  variantCount: number;
  activeVariantCount: number;
  fromPrice: string | null;
  updatedAt: string;
}
export interface ProductPage {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}
export interface VariantInput {
  id?: string;
  sku: string;
  attributes: Record<string, string>;
  optionsKey: string;
  barcode: string | null;
  priceMinor: string;
  isActive: boolean;
}
export interface ProductInput {
  styleCode: string;
  name: string;
  description: string;
  categoryId: string | null;
  status: ProductStatus;
  currency: 'BDT';
  variants: VariantInput[];
  expectedVersion?: number;
}
export interface CatalogQuery {
  search: string;
  status: ProductStatus | 'all';
  categoryId: string | null;
  page: number;
  pageSize: number;
}
