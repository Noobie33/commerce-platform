import { Dialog } from '../components/dialog';
import { categoryName, money } from './helpers';
import type { Category, Product } from './types';
export function ProductDetail({
  product,
  categories,
  onClose,
  onEdit,
}: {
  product: Product;
  categories: Category[];
  onClose: () => void;
  onEdit?: (p: Product) => void;
}) {
  return (
    <Dialog title={product.name} subtitle={product.styleCode} onClose={onClose} wide>
      <div className="dialog-body">
        <div className="product-detail-meta">
          <span className={'catalog-status status-' + product.status}>{product.status}</span>
          <span>{categoryName(product.categoryId, categories)}</span>
          <span>Revision {product.version}</span>
        </div>
        {product.description && <p className="product-description">{product.description}</p>}
        <div className="section-heading">
          <div>
            <h3>Variants & pricing</h3>
            <p>Individual SKUs for each sellable option.</p>
          </div>
          <span className="count-pill">{product.variants.length} SKUs</span>
        </div>
        <div className="table-scroll">
          <table className="catalog-table">
            <caption className="sr-only">Variants for {product.name}</caption>
            <thead>
              <tr>
                <th>SKU / options</th>
                <th>Barcode</th>
                <th>Retail price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong className="mono-text">{v.sku}</strong>
                    <small>
                      {Object.entries(v.attributes)
                        .map(([key, value]) => key + ': ' + value)
                        .join(' · ') || 'Standard'}
                    </small>
                  </td>
                  <td className="mono-text">{v.barcode || '—'}</td>
                  <td>{money(v.price)}</td>
                  <td>{v.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="catalog-note">
          Prices in BDT. Inventory quantities will appear when inventory is connected.
        </p>
      </div>
      <footer className="dialog-footer">
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
        {onEdit && (
          <button type="button" className="primary-button" onClick={() => onEdit(product)}>
            Edit product
          </button>
        )}
      </footer>
    </Dialog>
  );
}
