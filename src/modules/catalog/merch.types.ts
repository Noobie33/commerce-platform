export type MerchKind = 'size_guide' | 'collection';
export interface MerchRef {
  id: string;
  version: number;
}
export interface GuideDefinition {
  title: string;
  active: boolean;
  unit: 'cm' | 'in';
  basis: 'garment' | 'body';
  instructions: string;
  columns: string[];
  rows: { size: string; values: string[] }[];
}
export interface CollectionDefinition {
  title: string;
  active: boolean;
  description: string;
}
export type MerchDefinition = GuideDefinition | CollectionDefinition;
export interface MerchItem {
  id: string;
  kind: MerchKind;
  slug: string;
  version: number;
  definition: MerchDefinition;
  updatedAt: string;
}
export interface MerchSnapshot extends Omit<MerchItem, 'updatedAt'> {
  active: boolean;
}
export interface MerchAssignments {
  sizeGuide: MerchRef | null;
  collections: MerchRef[];
}
export interface MerchProjection {
  sizeGuide: MerchSnapshot | null;
  collections: MerchSnapshot[];
}
export interface MerchInput extends Omit<MerchItem, 'version' | 'updatedAt'> {
  expectedVersion: number;
  reason: string;
}
export interface MerchPage {
  items: MerchItem[];
  total: number;
  page: number;
  pageSize: number;
}
