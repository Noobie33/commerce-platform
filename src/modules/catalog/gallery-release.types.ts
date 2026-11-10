export interface GalleryReviewInput {
  action: 'approve' | 'revoke';
  expectedVersion: number;
  reason: string;
  expectedDraftVersion?: number;
  expectedBasis?: string;
  rightsConfirmed?: boolean;
}
export interface PublicGalleryItem {
  kind: 'photo' | 'video';
  id: string;
  label: string;
  width: number;
  height: number;
  primary?: boolean;
  durationSeconds?: number;
  hasAudio?: boolean;
  variantId?: string | null;
}
export interface GalleryReviewView {
  version: number;
  state: 'not_reviewed' | 'approved' | 'revoked';
  sourceDraftVersion: number | null;
  matchesDraft: boolean;
  eligible: boolean;
  currentDraftVersion: number;
  currentBasis: string;
  currentReady: boolean;
  approvedItems: PublicGalleryItem[];
  history: {
    version: number;
    action: string;
    reason: string;
    actorName: string;
    createdAt: string;
  }[];
}
