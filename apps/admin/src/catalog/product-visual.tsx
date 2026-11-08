import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import type { ProductPhoto } from './types';
export function ProductVisual({
  name,
  large = false,
  photo,
}: {
  name: string;
  large?: boolean;
  photo?: ProductPhoto | null;
}) {
  const [failed, setFailed] = useState(false);
  const url = photo ? (large ? photo.url : photo.thumbnailUrl) : null;
  useEffect(() => setFailed(false), [url]);
  return url && !failed ? (
    <div className={'product-visual has-product-photo' + (large ? ' product-visual-large' : '')}>
      <img
        src={url}
        alt={name}
        loading={large ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    </div>
  ) : (
    <div
      className={'product-visual' + (large ? ' product-visual-large' : '')}
      role="img"
      aria-label={(photo ? 'Photo unavailable for ' : 'No product photo for ') + name}
    >
      <Icon name="shirt" />
      <span>{photo ? 'Photo unavailable' : 'Photo not added'}</span>
    </div>
  );
}
