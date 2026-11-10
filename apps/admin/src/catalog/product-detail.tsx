import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../components/dialog';
import { Icon } from '../icons';
import { categoryName, money } from './helpers';
import { ProductVisual } from './product-visual';
import type { Category, Product } from './types';
export function ProductDetail({
  product,
  categories,
  onClose,
  onEdit,
  onManagePhotos,
  onContent,
  onVideos,
  onGallery,
  onPublication,
  inline = false,
}: {
  product: Product;
  categories: Category[];
  onClose: () => void;
  onEdit?: (p: Product) => void;
  onManagePhotos?: (p: Product) => void;
  onContent?: (p: Product) => void;
  onGallery?: (p: Product) => void;
  onVideos?: (p: Product) => void;
  onPublication?: (p: Product) => void;
  inline?: boolean;
}) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const photos = product.photos ?? [];
  const hero =
    photos.find((photo) => photo.id === selectedPhoto) ??
    photos.find((photo) => photo.isPrimary) ??
    photos[0] ??
    null;
  const titleId = useId(),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (inline) heading.current?.focus({ preventScroll: true });
  }, [product.id, inline]);
  const content = (
    <>
      <div className="product-detail-body">
        <div className="detail-product-heading">
          <div>
            <h3>{product.name}</h3>
            <span className="mono-text">{product.styleCode}</span>
          </div>
          <span className={'catalog-status status-' + product.status}>{product.status}</span>
        </div>
        <ProductVisual name={product.name} photo={hero} large />
        {photos.length > 1 && (
          <div className="detail-photo-strip" role="group" aria-label="Product photos">
            {photos.map((photo, index) => (
              <button
                type="button"
                key={photo.id}
                aria-label={'View photo ' + (index + 1)}
                aria-pressed={hero?.id === photo.id}
                onClick={() => setSelectedPhoto(photo.id)}
              >
                <img src={photo.thumbnailUrl} alt="" />
              </button>
            ))}
          </div>
        )}
        {hero?.originalAvailable && onManagePhotos && hero.originalUrl && (
          <a className="secondary-button original-download-link" href={hero.originalUrl} download>
            Download original
          </a>
        )}
        {onManagePhotos && (
          <button
            type="button"
            className="secondary-button manage-photos-button"
            onClick={() => onManagePhotos(product)}
          >
            {photos.length ? 'Manage photos' : 'Add product photos'}
          </button>
        )}

        {onGallery && (
          <button
            className="secondary-button manage-photos-button"
            onClick={() => onGallery(product)}
          >
            Product gallery
          </button>
        )}
        {onVideos && (
          <button
            className="secondary-button manage-photos-button"
            onClick={() => onVideos(product)}
          >
            Product videos
          </button>
        )}
        {onContent && (
          <button
            className="secondary-button manage-photos-button"
            onClick={() => onContent(product)}
          >
            Product content & review
          </button>
        )}
        {onPublication && (
          <button
            className="secondary-button manage-photos-button"
            onClick={() => onPublication(product)}
          >
            Website publication
          </button>
        )}
        <div className="detail-facts">
          <div>
            <span>From price</span>
            <strong>
              {money(
                product.variants
                  .filter((v) => v.isActive)
                  .map((v) => v.price)
                  .sort((a, b) => {
                    const x = BigInt(a.replace('.', '')),
                      y = BigInt(b.replace('.', ''));
                    return x < y ? -1 : x > y ? 1 : 0;
                  })[0] ?? null,
              )}
            </strong>
          </div>
          <div>
            <span>Variants</span>
            <strong>
              {product.variants.length} {product.variants.length === 1 ? 'SKU' : 'SKUs'}
            </strong>
          </div>
          <div>
            <span>Revision</span>
            <strong>{product.version}</strong>
          </div>
        </div>
        <details className="detail-section" open>
          <summary>
            <Icon name="catalog" />
            Product details
            <Icon name="chevron" />
          </summary>
          <div className="detail-section-content">
            <dl>
              <div>
                <dt>Category</dt>
                <dd>{categoryName(product.categoryId, categories)}</dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>BDT</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>
                  {new Intl.DateTimeFormat('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'Asia/Dhaka',
                  }).format(new Date(product.updatedAt))}
                </dd>
              </div>
            </dl>
            {product.description ? (
              <p className="product-description">{product.description}</p>
            ) : (
              <p className="catalog-note">No description added.</p>
            )}
          </div>
        </details>
        <details className="detail-section" open>
          <summary>
            <Icon name="shirt" />
            Variants & pricing
            <Icon name="chevron" />
          </summary>
          <div className="detail-section-content">
            <ul className="detail-variant-list">
              {product.variants.map((v) => (
                <li key={v.id}>
                  <div>
                    <strong className="mono-text">{v.sku}</strong>
                    <span>
                      {Object.entries(v.attributes)
                        .map(([key, value]) => key + ': ' + value)
                        .join(' · ') || 'Standard'}
                    </span>
                    {v.barcode && <span className="mono-text">Barcode: {v.barcode}</span>}
                  </div>
                  <div>
                    <strong>{money(v.price)}</strong>
                    <span className={v.isActive ? 'variant-live' : 'variant-inactive'}>
                      {v.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
      <footer className="detail-panel-footer">
        {onEdit ? (
          <button type="button" className="primary-button" onClick={() => onEdit(product)}>
            Edit product <Icon name="edit" />
          </button>
        ) : (
          <span className="catalog-note">Read-only access</span>
        )}
        <span className="catalog-note">Changes recorded in audit history.</span>
      </footer>
    </>
  );
  return inline ? (
    <aside
      className="product-detail-panel"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="detail-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          Product details
        </h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Close product details"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {content}
    </aside>
  ) : (
    <Dialog title="Product details" onClose={onClose}>
      {content}
    </Dialog>
  );
}
