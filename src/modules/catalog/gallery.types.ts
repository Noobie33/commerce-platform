export interface GalleryItem {
  kind: 'photo' | 'video';
  id: string;
}
export interface GalleryInput {
  action: 'save';
  expectedVersion: number;
  expectedBasis: string;
  reason: string;
  items: GalleryItem[];
}
export interface GalleryAsset extends GalleryItem {
  label: string;
  width: number | null;
  height: number | null;
  primary: boolean;
  selectable: boolean;
  state: string;
  reviewState: string;
  variantId: string | null;
  variantSku: string | null;
  hasAudio: boolean;
  durationSeconds: number | null;
  url: string | null;
  thumbnailUrl: string | null;
}
export interface GalleryView {
  productId: string;
  productVersion: number;
  version: number;
  basis: string;
  items: GalleryItem[];
  assets: GalleryAsset[];
  issues: string[];
  history: {
    version: number;
    reason: string;
    actorName: string;
    items: GalleryItem[];
    createdAt: string;
  }[];
  page: number;
  hasMore: boolean;
}
