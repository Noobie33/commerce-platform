export interface ProductPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  isPrimary: boolean;
  originalAvailable: boolean;
  originalWidth: number | null;
  originalHeight: number | null;
  originalBytes: number | null;
  originalUrl: string | null;
}
export interface MediaResult {
  productId: string;
  version: number;
  photos: ProductPhoto[];
}
export function photoLinks<T extends { id: string; originalAvailable?: boolean }>(photo: T) {
  return {
    ...photo,
    originalUrl: photo.originalAvailable
      ? '/api/v1/catalog/photos/' + photo.id + '/original'
      : null,
    url: '/api/v1/catalog/photos/' + photo.id + '/image',
    thumbnailUrl: '/api/v1/catalog/photos/' + photo.id + '/thumbnail',
  };
}
