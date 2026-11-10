import type { SeoInput, WebsitePreparation } from './presentation-types';
import type { MerchAssignments, MerchProjection } from './merch-types';
export type ContentState = 'draft' | 'in_review' | 'approved' | 'changes_requested';
export interface SpecificationField {
  label: string;
  kind: 'text' | 'choice' | 'decimal';
  max?: number;
  required?: boolean;
  options?: string[];
}
export interface ContentProfile {
  code: string;
  label: string;
  fields: Record<string, SpecificationField>;
}
export interface ContentSnapshot {
  seo?: SeoInput;
  merchandising?: MerchProjection;
  productId: string;
  productVersion: number;
  styleCode: string;
  name: string;
  status: string;
  category: { id: string; name: string; active: boolean } | null;
  currency: 'BDT';
  profile: string | null;
  slug: string | null;
  description: string | null;
  specifications: Record<string, string> | null;
  variants: { id: string; sku: string; attributes: Record<string, string>; priceMinor: string }[];
  photos: { id: string; width: number; height: number; primary: boolean; hash: string }[];
}
export interface ContentRecord {
  profile: string;
  slug: string;
  description: string;
  specifications: Record<string, string>;
  state: ContentState;
  version: number;
  updatedAt: string;
  submittedSnapshot: ContentSnapshot | null;
}
export interface ContentEvent {
  version: number;
  state: ContentState;
  action: string;
  reason: string;
  actorName: string;
  createdAt: string;
  snapshot: ContentSnapshot;
}
export interface ContentView {
  preparation: WebsitePreparation;
  productId: string;
  productVersion: number;
  record: ContentRecord | null;
  profiles: ContentProfile[];
  issues: string[];
  preview: ContentSnapshot;
  current: boolean;
  history: { items: ContentEvent[]; total: number; page: number; pageSize: number };
}
export interface ContentInput {
  action: 'save' | 'submit' | 'approve' | 'request_changes' | 'withdraw';
  expectedVersion: number;
  expectedProductVersion: number;
  profile?: string;
  slug?: string;
  description?: string;
  specifications?: Record<string, string>;
  reason?: string;
  merchandising?: MerchAssignments;
  seo?: SeoInput;
}
export interface ContentResult {
  productId: string;
  version: number;
  state: ContentState;
}
