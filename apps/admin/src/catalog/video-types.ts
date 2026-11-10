export interface ProductVideo {
  id: string;
  version: number;
  state: 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled' | 'removed';
  attempts: number;
  description: string;
  variantId: string | null;
  position: number;
  reviewState: 'not_reviewed' | 'approved' | 'revoked';
  errorCode: string | null;
  sourceBytes: string;
  sourceType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  hasAudio: boolean | null;
  createdAt: string;
}
export interface VideoPage {
  enabled: boolean;
  productVersion: number;
  items: ProductVideo[];
  total: number;
  page: number;
  pageSize: number;
  policy: {
    maxPerProduct: number;
    maxPending: number;
    maxSourceBytes: number;
    maxDurationSeconds: number;
  };
}
export interface VideoHistory {
  items: {
    version: number;
    action: string;
    reason: string;
    snapshot: { state: string; performedBy?: string };
    actorName: string;
    createdAt: string;
  }[];
  page: number;
  hasMore: boolean;
}
export interface VideoResult {
  id: string;
  version: number;
  state: ProductVideo['state'];
}
