export interface SeoInput {
  title: string;
  description: string;
}
export interface TaxonomyInput {
  id: string;
  expectedVersion: number;
  name: string;
  parentId: string | null;
  active: boolean;
  slug: string;
  seo: SeoInput;
  reason: string;
}
export interface CategoryPathItem {
  id: string;
  name: string;
  slug: string | null;
  active: boolean;
}
export interface TaxonomyItem {
  id: string;
  name: string;
  parentId: string | null;
  active: boolean;
  version: number;
  slug: string | null;
  seo: SeoInput;
  path: CategoryPathItem[];
  activeProducts: number;
}
export interface TaxonomyPage {
  items: TaxonomyItem[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PreparationCheck {
  code: string;
  passed: boolean;
  message: string;
}
export interface WebsitePreparation {
  checks: PreparationCheck[];
  categoryPath: CategoryPathItem[];
  searchTitle: string;
  searchDescription: string;
}
