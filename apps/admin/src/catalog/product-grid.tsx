import { categoryName, money } from './helpers';
import { ProductVisual } from './product-visual';
import type { Category, ProductSummary } from './types';
export function ProductGrid({
  products,
  categories,
  selectedId,
  opening,
  onOpen,
}: {
  products: ProductSummary[];
  categories: Category[];
  selectedId: string | undefined;
  opening: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="product-grid" aria-label="Product collection">
      {products.map((product) => (
        <button
          type="button"
          key={product.id}
          className={'product-card' + (selectedId === product.id ? ' product-card-selected' : '')}
          aria-label={'View ' + product.name}
          aria-pressed={selectedId === product.id}
          disabled={opening}
          onClick={() => onOpen(product.id)}
        >
          <div className="product-card-media">
            <ProductVisual name={product.name} photo={product.primaryPhoto} />
            <span className={'catalog-status status-' + product.status}>{product.status}</span>
          </div>
          <div className="product-card-content">
            <span className="product-card-category">
              {categoryName(product.categoryId, categories)}
            </span>
            <strong>{product.name}</strong>
            <span className="product-card-code mono-text">{product.styleCode}</span>
            <div className="product-card-bottom">
              <span className="price-cell">{money(product.fromPrice)}</span>
              <span>
                {product.variantCount} {product.variantCount === 1 ? 'SKU' : 'SKUs'}
              </span>
            </div>
            <span className="product-card-active">
              {product.activeVariantCount} active{' '}
              {product.activeVariantCount === 1 ? 'variant' : 'variants'}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
