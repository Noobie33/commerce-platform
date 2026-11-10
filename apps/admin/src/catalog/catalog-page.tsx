import { TaxonomyManager } from './taxonomy-manager';
import { MerchLibrary } from './merch-library';
import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import { ProductContent } from './product-content';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
const ProductPublication = lazy(() =>
  import('./product-publication').then((m) => ({ default: m.ProductPublication })),
);
const ProductGallery = lazy(() =>
  import('./product-gallery').then((m) => ({ default: m.ProductGallery })),
);
const ProductVideos = lazy(() =>
  import('./product-videos').then((m) => ({ default: m.ProductVideos })),
);
import { StaffApi } from '../api';
import { Icon } from '../icons';
import { categoryName, money } from './helpers';
import { CategoryDialog } from './category-dialog';
import { ProductEditor } from './product-editor';
import { ProductDetail } from './product-detail';
import { ProductGrid } from './product-grid';
import { MediaManager } from './media-manager';
import type { Category, Product, ProductStatus } from './types';
export function CatalogPage({
  api,
  canManage,
  canManageContent,
  canReviewContent,
  canManageMerch,
  canManageTaxonomy,
  canReviewMedia,
  canPublish,
}: {
  api: StaffApi;
  canManage: boolean;
  canManageContent: boolean;
  canReviewContent: boolean;
  canManageMerch: boolean;
  canManageTaxonomy: boolean;
  canReviewMedia: boolean;
  canPublish: boolean;
}) {
  const [galleryProduct, setGalleryProduct] = useState<Product | null>(null);
  const [videoProduct, setVideoProduct] = useState<Product | null>(null);
  const [publicationProduct, setPublicationProduct] = useState<Product | null>(null);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [merchOpen, setMerchOpen] = useState(false);
  const [contentProduct, setContentProduct] = useState<Product | null>(null);
  const [mediaProduct, setMediaProduct] = useState<Product | null>(null);
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1180px)').matches);
  const lastTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1180px)');
    const changed = () => setWide(media.matches);
    media.addEventListener('change', changed);

    return () => media.removeEventListener('change', changed);
  }, []);
  function closeDetails() {
    setDetail(null);
    if (lastTrigger.current?.isConnected) lastTrigger.current.focus({ preventScroll: true });
    else document.getElementById('page-title')?.focus({ preventScroll: true });
  }
  const [categories, setCategories] = useState<Category[]>([]),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState<ProductStatus | 'all'>('all'),
    [categoryId, setCategory] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState(false),
    [actionError, setError] = useState(''),
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
  useEffect(() => setError(''), [query, status, categoryId, page, revision]);
  const read = useLiveRead(
    useCallback(
      (options) =>
        Promise.all([
          api.products({ search: query, status, categoryId, page }, options),
          api.categories(options),
        ]),
      [api, query, status, categoryId, page],
    ),
    {
      topics: ['catalog'],
      revision,
      paused: !!(
        editor ||
        detail ||
        mediaProduct ||
        videoProduct ||
        galleryProduct ||
        publicationProduct ||
        contentProduct ||
        categoryOpen ||
        merchOpen ||
        taxonomyOpen
      ),
    },
  );
  const data = read.data?.[0] ?? null,
    categoriesFromRead = read.data?.[1] ?? [];
  const loading = read.loading,
    error = read.error || actionError;
  useEffect(() => {
    if (read.data) setCategories(categoriesFromRead);
    else if (read.accessDenied) setCategories([]);
  }, [read.data, read.accessDenied]);
  useEffect(() => {
    if (data) {
      const last = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > last) setPage(last);
    }
  }, [data, page]);
  async function open(id: string) {
    lastTrigger.current = document.activeElement as HTMLElement | null;
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
  function startCreate() {
    lastTrigger.current = document.activeElement as HTMLElement | null;
    setNotice('');
    setEditor({ initial: null });
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
          <span className="eyebrow">WORKSPACE / CATALOG</span>
          <h1 id="page-title" tabIndex={-1}>
            Product catalog
          </h1>
          <p>Manage your styles, variants and pricing in one place.</p>
        </div>
        {canManage && (
          <button
            className="primary-button"
            onClick={() => {
              startCreate();
            }}
          >
            + Create product
          </button>
        )}
      </div>
      <div className="merch-actions">
        <button className="secondary-button" onClick={() => setTaxonomyOpen(true)}>
          Categories & SEO
        </button>
        <button className="secondary-button" onClick={() => setMerchOpen(true)}>
          Size guides & collections
        </button>
      </div>
      <ReadStatus read={read} />

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
      <div className={'catalog-workbench' + (detail && wide ? ' with-product-details' : '')}>
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
          <div className="catalog-collection-controls">
            <div className="catalog-status-tabs" role="group" aria-label="Product status">
              {(['all', 'active', 'draft', 'archived'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={status === value}
                  onClick={() => {
                    setStatus(value);
                    setPage(1);
                  }}
                >
                  {value === 'all'
                    ? 'All products'
                    : value.charAt(0).toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
            <div className="catalog-view-controls">
              <span className="catalog-order">Newest first</span>
              <div role="group" aria-label="Catalog view">
                <button
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                >
                  <Icon name="grid" />
                </button>
                <button
                  type="button"
                  aria-label="Table view"
                  aria-pressed={view === 'table'}
                  onClick={() => setView('table')}
                >
                  <Icon name="list" />
                </button>
              </div>
              <button
                className="icon-button"
                aria-label="Refresh catalog"
                disabled={loading || read.refreshing}
                onClick={() => setRevision((v) => v + 1)}
              >
                <Icon name="refresh" />
              </button>
            </div>
          </div>
          <div className="catalog-result-count" aria-live="polite">
            {loading
              ? 'Loading products…'
              : data
                ? data.total +
                  (data.total === 1 ? ' product' : ' products') +
                  (status !== 'all' || query || categoryId
                    ? ' matching your filters'
                    : ' in your catalog')
                : ''}
            {(query || status !== 'all' || categoryId) && (
              <button
                className="text-button"
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
            )}
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
              {view === 'grid' ? (
                <ProductGrid
                  products={data.items}
                  categories={categories}
                  selectedId={detail?.id}
                  opening={opening}
                  onOpen={(id) => void open(id)}
                />
              ) : (
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
              )}
              <footer className="catalog-pagination">
                <span>
                  {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of{' '}
                  {data.total} {data.total === 1 ? 'product' : 'products'}
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
                  <button className="primary-button" onClick={startCreate}>
                    Create your first product <Icon name="arrow" />
                  </button>
                )
              )}
            </div>
          )}
        </div>
        {detail && (
          <ProductDetail
            onGallery={(p) => {
              setGalleryProduct(p);
              setDetail(null);
            }}
            onVideos={(p) => {
              setVideoProduct(p);
              setDetail(null);
            }}
            onPublication={(p) => {
              setPublicationProduct(p);
              setDetail(null);
            }}
            onContent={(p) => {
              setContentProduct(p);
              setDetail(null);
            }}
            product={detail}
            categories={categories}
            inline={wide}
            onClose={closeDetails}
            {...(canManage
              ? {
                  onManagePhotos: (p: Product) => {
                    setDetail(null);
                    setMediaProduct(p);
                  },
                  onEdit: (p: Product) => {
                    setDetail(null);
                    setEditor({ initial: p });
                  },
                }
              : {})}
          />
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
      {publicationProduct && (
        <Suspense fallback={<p role="status">Opening publication...</p>}>
          <ProductPublication
            api={api}
            product={publicationProduct}
            canReviewMedia={canReviewMedia}
            canPublish={canPublish}
            close={() => {
              setPublicationProduct(null);
              void open(publicationProduct.id);
            }}
          />
        </Suspense>
      )}
      {contentProduct && (
        <ProductContent
          api={api}
          product={contentProduct}
          canManage={canManageContent}
          canReview={canReviewContent}
          close={() => {
            setContentProduct(null);
            void open(contentProduct.id);
          }}
        />
      )}
      {galleryProduct && (
        <Suspense fallback={<p role="status">Opening gallery...</p>}>
          <ProductGallery
            api={api}
            product={galleryProduct}
            canManage={canManage}
            close={() => {
              setGalleryProduct(null);
              void open(galleryProduct.id);
            }}
          />
        </Suspense>
      )}
      {videoProduct && (
        <Suspense fallback={<p role="status">Opening product videos...</p>}>
          <ProductVideos
            api={api}
            product={videoProduct}
            canManage={canManage}
            canReview={canReviewMedia}
            close={() => {
              setVideoProduct(null);
              void open(videoProduct.id);
            }}
          />
        </Suspense>
      )}
      {mediaProduct && (
        <MediaManager
          api={api}
          initial={mediaProduct}
          onClose={() => {
            setMediaProduct(null);
            void open(mediaProduct.id);
          }}
          onChanged={(result) => {
            setMediaProduct((p) =>
              p ? { ...p, version: result.version, photos: result.photos } : p,
            );
            setRevision((v) => v + 1);
          }}
          onReload={(product) => {
            setMediaProduct(product);
            setRevision((v) => v + 1);
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
      {merchOpen && (
        <MerchLibrary api={api} canManage={canManageMerch} close={() => setMerchOpen(false)} />
      )}
      {taxonomyOpen && (
        <TaxonomyManager
          api={api}
          canManage={canManageTaxonomy}
          close={() => {
            setTaxonomyOpen(false);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
