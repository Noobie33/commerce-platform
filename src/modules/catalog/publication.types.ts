export interface PublicationInput {
  action: 'approve' | 'revoke' | 'publish' | 'unpublish';
  expectedVersion: number;
  reason: string;
  alt?: string;
  expectedProductVersion?: number;
  expectedContentVersion?: number;
}
export interface PublicationView {
  productId: string;
  productVersion: number;
  contentVersion: number;
  version: number;
  state: 'published' | 'unpublished' | 'never_published';
  effectivePublic: boolean;
  issues: string[];
  photos: { id: string; version: number; state: string; alt: string; thumbnailUrl: string }[];
  history: { version: number; kind: string; action: string; reason: string; createdAt: string }[];
  page: number;
  hasMore: boolean;
}
