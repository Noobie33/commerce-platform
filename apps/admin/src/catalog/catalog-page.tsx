import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Icon } from '../icons';
import { categoryName, money } from './helpers';
import { CategoryDialog } from './category-dialog';
import { ProductEditor } from './product-editor';
import { ProductDetail } from './product-detail';
import type { Category, Product, ProductPage, ProductStatus } from './types';
export function CatalogPage({ api, canManage }: { api: StaffApi; canManage: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]),
    [data, setData] = useState<ProductPage | null>(null),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState<ProductStatus | 'all'>('all'),
    [categoryId, setCategory] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [categoryOpen, setCategoryOpen] = useState(false),
    [editor, setEditor] = useState<{ initial: Product | null } | null>(null),
    [detail, setDetail] = useState<Product | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([api.products({ search: query, status, categoryId, page }), api.categories()])
      .then(([products, cats]) => {
        if (active) {
          setData(products);
          setCategories(cats);
        }
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'Unable to load catalog.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, query, status, categoryId, page, revision]);
  async function open(id: string) {
    setOpening(true);
    setError('');
    try {
      setDetail(await api.product(id));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to open product.');
    } finally {
      setOpening(false);
    }
  }
  function saved(product: Product) {
    const creating = !editor?.initial;
    setEditor(null);
    setDetail(product);
    setNotice('Product saved successfully.');
    if (creating) {
      setSearch('');
      setQuery('');
      setStatus('all');
      setCategory('');
      setPage(1);
    }
    setRevision((v) => v + 1);
  }
  return (
    <section className="catalog-page">
      <div className="page-heading catalog-heading">
        <div>
          <span className="eyebrow">YOUR COLLECTION, CONNECTED</span>
          <h1 id="page-title" tabIndex={-1}>
            Product catalog<span className="heading-dot">.</span>
          </h1>
          <p>One home for every style, size and colour.</p>
        </div>
        {canManage && (
          <button
            className="primary-button"
            onClick={() => {
              setNotice('');
              setEditor({ initial: null });
            }}
          >
            + Create product
          </button>
        )}
      </div>
      <div className="catalog-intro">
        <div className="catalog-intro-symbol">
          <Icon name="catalog" />
        </div>
        <div>
          <strong>Build a considered collection.</strong>
          <p>
            Keep product details consistent across your future stores, stockrooms and sales
            channels.
          </p>
        </div>
        <span className="catalog-currency">BDT · RETAIL PRICING</span>
      </div>
      {notice && (
        <p className="catalog-notice" role="status">
          <Icon name="check" />
          {notice}
          <button
            className="text-button"
            onClick={() => setNotice('')}
            aria-label="Dismiss notification"
          >
            Dismiss
          </button>
        </p>
      )}
      <div className="panel catalog-panel">
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <Icon name="search" />
            <span className="sr-only">Search products</span>
            <input
              type="search"
              maxLength={100}
              placeholder="Search name, style, SKU or barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Product status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Category filter</span>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c.id, categories)}
                </option>
              ))}
            </select>
          </label>
          {canManage && (
            <button className="text-button" onClick={() => setCategoryOpen(true)}>
              + Category
            </button>
          )}
        </div>
        <div className="catalog-results-heading">
          <strong>Collection</strong>
          <span aria-live="polite">
            {loading
              ? 'Loading…'
              : data
                ? data.total + (data.total === 1 ? ' product' : ' products')
                : ''}
          </span>
          <button
            className="icon-button"
            aria-label="Refresh catalog"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            <Icon name="refresh" />
          </button>
        </div>
        {error ? (
          <div className="catalog-empty" role="alert">
            <h3>We couldn’t load your collection.</h3>
            <p>{error}</p>
            <button className="secondary-button" onClick={() => setRevision((v) => v + 1)}>
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="catalog-empty" role="status">
            <span className="loading-ring" />
            <p>Bringing your collection together…</p>
          </div>
        ) : data?.items.length ? (
          <>
            <div className="table-scroll">
              <table className="catalog-table product-list">
                <caption className="sr-only">Product collection</caption>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Variants</th>
                    <th>From price</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <button
                          className="product-link"
                          onClick={() => void open(product.id)}
                          disabled={opening}
                        >
                          <span className="product-monogram" aria-hidden="true">
                            {product.name.slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <strong>{product.name}</strong>
                            <small className="mono-text">{product.styleCode}</small>
                          </span>
                        </button>
                      </td>
                      <td>{categoryName(product.categoryId, categories)}</td>
                      <td>
                        <strong>{product.variantCount} SKUs</strong>
                        <small>{product.activeVariantCount} active</small>
                      </td>
                      <td className="price-cell">{money(product.fromPrice)}</td>
                      <td>
                        <span className={'catalog-status status-' + product.status}>
                          {product.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={'View ' + product.name}
                          disabled={opening}
                          onClick={() => void open(product.id)}
                        >
                          <Icon name="arrow" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="catalog-pagination">
              <span>
                {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of{' '}
                {data.total} products
              </span>
              <div>
                <button
                  className="secondary-button"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span>Page {page}</span>
                <button
                  className="secondary-button"
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="catalog-empty">
            <div className="empty-symbol">
              <Icon name="catalog" />
            </div>
            <span className="eyebrow">
              {query || status !== 'all' || categoryId ? 'REFINE YOUR SEARCH' : 'A FRESH START'}
            </span>
            <h3>
              {query || status !== 'all' || categoryId
                ? 'No matching products'
                : 'Your collection starts here'}
            </h3>
            <p>
              {query || status !== 'all' || categoryId
                ? 'Try another name, SKU or filter.'
                : 'Add your first product, then bring its sizes, colours and prices together.'}
            </p>
            {query || status !== 'all' || categoryId ? (
              <button
                className="secondary-button"
                onClick={() => {
                  setSearch('');
                  setQuery('');
                  setStatus('all');
                  setCategory('');
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            ) : (
              canManage && (
                <button className="primary-button" onClick={() => setEditor({ initial: null })}>
                  Create your first product <Icon name="arrow" />
                </button>
              )
            )}
          </div>
        )}
      </div>
      <p className="catalog-bottom-note">
        <Icon name="lock" /> Catalog changes are recorded in your business audit history.
      </p>
      {categoryOpen && (
        <CategoryDialog
          api={api}
          categories={categories}
          onClose={() => setCategoryOpen(false)}
          onCreated={(c) => {
            setCategories((rows) => [...rows, c]);
            setCategoryOpen(false);
            setNotice('Category created.');
          }}
        />
      )}
      {editor && (
        <ProductEditor
          api={api}
          initial={editor.initial}
          categories={categories}
          onCategories={setCategories}
          onClose={() => setEditor(null)}
          onSaved={saved}
          onReload={(product) => {
            setEditor(null);
            setDetail(product);
            setNotice('');
            setRevision((v) => v + 1);
          }}
        />
      )}
      {detail && (
        <ProductDetail
          product={detail}
          categories={categories}
          onClose={() => setDetail(null)}
          {...(canManage
            ? {
                onEdit: (p: Product) => {
                  setDetail(null);
                  setEditor({ initial: p });
                },
              }
            : {})}
        />
      )}
    </section>
  );
}
