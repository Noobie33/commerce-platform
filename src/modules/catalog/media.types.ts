export interface ProductPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  isPrimary: boolean;
}
export interface MediaResult {
  productId: string;
  version: number;
  photos: ProductPhoto[];
}
export function photoLinks<T extends { id: string }>(photo: T) {
  return {
    ...photo,
    url: '/api/v1/catalog/photos/' + photo.id + '/image',
    thumbnailUrl: '/api/v1/catalog/photos/' + photo.id + '/thumbnail',
  };
}
