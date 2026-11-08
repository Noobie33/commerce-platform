export interface Category {
  id: string;
  name: string;
  parentId: string | null;
}
export interface CatalogVariant {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  barcode: string | null;
  price: string;
  isActive: boolean;
}
export type ProductStatus = 'draft' | 'active' | 'archived';
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
  variants: CatalogVariant[];
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
export interface VariantDraft {
  key: string;
  id?: string;
  sku: string;
  attributes: Record<string, string>;
  barcode: string;
  price: string;
  isActive: boolean;
}
export interface ProductPayload {
  styleCode: string;
  name: string;
  description: string;
  categoryId: string | null;
  status: ProductStatus;
  currency: 'BDT';
  expectedVersion?: number;
  variants: {
    id?: string;
    sku: string;
    attributes: Record<string, string>;
    barcode: string | null;
    price: string;
    isActive: boolean;
  }[];
}
