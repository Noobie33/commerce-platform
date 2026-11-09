import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import type { ReversalPreview } from './types';
import { useCallback, useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Icon } from '../icons';
import { PostingDialog, labels } from './posting-dialog';
import { LocationDialog } from './location-dialog';
import type { HistoryRow, PostingKind } from './types';
import './inventory.css';
export function InventoryPage({
  api,
  canManageLocations,
}: {
  api: StaffApi;
  canManageLocations: boolean;
}) {
  const [locationId, setLocation] = useState('');

  const [tab, setTab] = useState<'stock' | 'history'>('stock'),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [locationRevision, setLocationRevision] = useState(0),
    [actionError, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [reversalPreview, setReversalPreview] = useState<ReversalPreview[]>([]),
    [openingPreview, setOpeningPreview] = useState(false);
  const [action, setAction] = useState<PostingKind | null>(null),
    [reversing, setReversing] = useState<HistoryRow | undefined>(),
    [locationOpen, setLocationOpen] = useState(false);
  const locationRead = useLiveRead(
    useCallback((options) => api.inventoryLocations(options), [api]),
    {
      revision: locationRevision,
      paused: !!(action || reversing || locationOpen || openingPreview),
    },
  );
  const locations = locationRead.data ?? [],
    locationsReady = !locationRead.loading,
    locationError = locationRead.error;
  const selectedId = locations.some((l) => l.id === locationId) ? locationId : '';
  useEffect(() => {
    if (locationRead.data || locationRead.accessDenied) {
      setLocation((id) =>
        locationRead.data?.some((l) => l.id === id) ? id : (locationRead.data?.[0]?.id ?? ''),
      );
    }
  }, [locationRead.data, locationRead.accessDenied]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => setError(''), [selectedId, query, filter, page, tab, revision]);
  const read = useLiveRead(
    useCallback(
      (options) =>
        Promise.all([
          api.stock(
            selectedId,
            { search: query, stock: filter, page: tab === 'stock' ? page : 1 },
            options,
          ),
          tab === 'history'
            ? api.stockHistory(selectedId, { search: query, page }, options)
            : Promise.resolve(null),
        ]),
      [api, selectedId, query, filter, page, tab],
    ),
    {
      revision,
      enabled: !!selectedId && !locationRead.accessDenied,
      paused: !!(action || reversing || locationOpen || openingPreview),
    },
  );
  const stock = read.data?.[0] ?? null,
    history = read.data?.[1] ?? null,
    loading = read.loading,
    error = read.error || actionError;
  useEffect(() => {
    const total = (tab === 'stock' ? stock : history)?.total;
    if (total !== undefined) {
      const last = Math.max(1, Math.ceil(total / 20));
      if (page > last) setPage(last);
    }
  }, [stock, history, page, tab]);
  const location = locations.find((l) => l.id === locationId),
    data = tab === 'stock' ? stock : history,
    totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));
  const done = () => {
    setAction(null);
    setReversing(undefined);
    setNotice('Stock posted. Balances and movement history are up to date.');
    setRevision((n) => n + 1);
  };
  return (
    <div className="inventory-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR OPERATIONS</span>
          <h1 id="page-title" tabIndex={-1}>
            Stock & locations
          </h1>
          <p>One clear picture of physical stock, across every warehouse and store.</p>
        </div>
        <div className="inventory-actions">
          {canManageLocations && (
            <button
              className="secondary-button"
              disabled={openingPreview}
              onClick={() => setLocationOpen(true)}
            >
              New location <Icon name="plus" />
            </button>
          )}
        </div>
      </div>
      <ReadStatus read={selectedId ? read : locationRead} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {locationError ? (
        <div className="form-error" role="alert">
          {locationError}{' '}
          <button className="text-button" onClick={() => setLocationRevision((n) => n + 1)}>
            Retry locations
          </button>
        </div>
      ) : !locationsReady ? (
        <p role="status">Loading locations…</p>
      ) : !locations.length ? (
        <section className="panel inventory-empty">
          <Icon name="catalog" />
          <h2>A place for every piece</h2>
          <p>
            {canManageLocations
              ? 'Create your first warehouse or store, then record its opening stock.'
              : 'No locations are available for your account. Ask your administrator for location access.'}
          </p>
          {canManageLocations && (
            <button
              className="primary-button"
              disabled={openingPreview}
              onClick={() => setLocationOpen(true)}
            >
              Create first location
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="panel inventory-location">
            <label>
              Current location
              <select
                disabled={openingPreview}
                value={locationId}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setPage(1);
                  setNotice('');
                }}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.code}
                  </option>
                ))}
              </select>
            </label>
            <span className="badge badge-outline">
              {location?.kind === 'store' ? 'Retail store' : 'Warehouse'}
            </span>
            <div className="inventory-actions">
              {location?.canReceive && (
                <>
                  <button
                    className="secondary-button"
                    disabled={openingPreview}
                    onClick={() => setAction('opening')}
                  >
                    Opening stock
                  </button>
                  <button
                    className="primary-button"
                    disabled={openingPreview}
                    onClick={() => setAction('receipt')}
                  >
                    Receive stock <Icon name="plus" />
                  </button>
                </>
              )}
              {location?.canTransfer && (
                <button
                  className="secondary-button"
                  disabled={
                    openingPreview || !locations.some((l) => l.id !== locationId && l.canTransfer)
                  }
                  onClick={() => setAction('transfer')}
                >
                  Transfer stock
                </button>
              )}
              {location?.canAdjust && (
                <button
                  className="secondary-button"
                  disabled={openingPreview}
                  onClick={() => setAction('adjustment')}
                >
                  Adjust stock
                </button>
              )}
            </div>
          </section>
          <div className="inventory-stats" aria-label="Location stock summary">
            {[
              ['On-hand pieces', stock?.summary.units],
              ['Recorded SKUs', stock?.summary.recordedSkus],
              ['With stock', stock?.summary.positiveSkus],
              ['Zero stock', stock?.summary.zeroSkus],
            ].map(([label, value]) => (
              <div className="panel" key={label}>
                <span>{label}</span>
                <strong>{value === undefined ? '—' : BigInt(value).toLocaleString('en-BD')}</strong>
              </div>
            ))}
          </div>
          <section className="panel inventory-content">
            <div className="inventory-toolbar">
              <div className="inventory-tabs" role="group" aria-label="Inventory view">
                <button
                  aria-pressed={tab === 'stock'}
                  onClick={() => {
                    setTab('stock');
                    setPage(1);
                  }}
                >
                  Stock overview
                </button>
                <button
                  aria-pressed={tab === 'history'}
                  onClick={() => {
                    setTab('history');
                    setPage(1);
                  }}
                >
                  Movement history
                </button>
              </div>
              <div className="inventory-filters">
                <label className="sr-only" htmlFor="stock-search">
                  Search inventory
                </label>
                <input
                  id="stock-search"
                  type="search"
                  maxLength={100}
                  placeholder={
                    tab === 'stock' ? 'Search product or SKU' : 'Search SKU, reason or reference'
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {tab === 'stock' && (
                  <>
                    <label className="sr-only" htmlFor="stock-filter">
                      Stock status
                    </label>
                    <select
                      id="stock-filter"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="all">All recorded SKUs</option>
                      <option value="positive">With stock</option>
                      <option value="zero">Zero stock</option>
                    </select>
                  </>
                )}
                <button
                  className="icon-button"
                  aria-label="Refresh inventory"
                  onClick={() => setRevision((n) => n + 1)}
                  disabled={loading || read.refreshing}
                >
                  <Icon name="refresh" />
                </button>
              </div>
            </div>
            {error ? (
              <div className="inventory-empty form-error" role="alert">
                {error}
                <button className="text-button" onClick={() => setRevision((n) => n + 1)}>
                  Try again
                </button>
              </div>
            ) : loading ? (
              <div className="inventory-empty" role="status">
                Loading inventory…
              </div>
            ) : tab === 'stock' ? (
              stock?.items.length ? (
                <div className="table-scroll">
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>Product / SKU</th>
                        <th>Variant</th>
                        <th>Status</th>
                        <th className="quantity-cell">On hand (pcs)</th>
                        <th className="quantity-cell">Reserved</th>
                        <th className="quantity-cell">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.items.map((row) => (
                        <tr key={row.variantId}>
                          <td>
                            <strong>{row.productName}</strong>
                            <small>{row.sku}</small>
                          </td>
                          <td>
                            {Object.entries(row.attributes)
                              .map(([key, val]) => key + ': ' + val)
                              .join(' · ') || 'Standard'}
                          </td>
                          <td>
                            <span
                              className={
                                'badge ' + (row.available === '0' ? 'badge-outline' : 'badge-green')
                              }
                            >
                              {row.quantity === '0'
                                ? 'Zero stock'
                                : row.available === '0'
                                  ? 'Fully reserved'
                                  : 'Available stock'}
                            </span>
                            {(!row.isActive || row.productStatus === 'archived') && (
                              <small>Inactive catalog item</small>
                            )}
                          </td>
                          <td className="quantity-cell">
                            <strong>{BigInt(row.quantity).toLocaleString('en-BD')}</strong>
                          </td>
                          <td className="quantity-cell">
                            {BigInt(row.reserved).toLocaleString('en-BD')}
                          </td>
                          <td className="quantity-cell">
                            <strong>{BigInt(row.available).toLocaleString('en-BD')}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="inventory-empty">
                  <h3>
                    {query || filter !== 'all' ? 'No matching stock' : 'Your stock starts here'}
                  </h3>
                  <p>
                    {query || filter !== 'all'
                      ? 'Try another search or stock filter.'
                      : 'Record opening stock or a receipt. Only SKUs with a recorded stock movement appear here.'}
                  </p>
                </div>
              )
            ) : (
              <div className="inventory-history">
                {history?.items.length ? (
                  history.items.map((row) => (
                    <article key={row.id}>
                      <header>
                        <span
                          className={
                            'badge ' + (row.kind === 'reversal' ? 'badge-outline' : 'badge-green')
                          }
                        >
                          {labels[row.kind]}
                        </span>
                        <time dateTime={row.createdAt}>
                          {new Date(row.createdAt).toLocaleString()}
                        </time>
                      </header>
                      <h3>{row.reason}</h3>
                      <p className="small muted">
                        {row.actorName}
                        {row.reference ? ' · ' + row.reference : ''}
                      </p>
                      <details>
                        <summary>
                          {row.lines.length} SKU{row.lines.length === 1 ? '' : 's'} · View stock
                          changes
                        </summary>
                        <ul>
                          {row.lines.map((line) => (
                            <li key={line.variantId}>
                              <span>
                                <strong>{line.productName}</strong>
                                <small>{line.sku}</small>
                              </span>
                              <span>
                                {line.quantityBefore}{' '}
                                <strong>
                                  {line.delta.startsWith('-') ? '−' : '+'}
                                  {line.delta.replace('-', '')}
                                </strong>{' '}
                                → {line.quantityAfter} pcs
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                      <footer>
                        <code title={row.id}>{row.id.slice(0, 8)}</code>
                        {row.reversedBy ? (
                          <span className="small muted">
                            Reversed · {row.reversedBy.slice(0, 8)}
                          </span>
                        ) : row.reversalOf ? (
                          <span className="small muted">Corrects {row.reversalOf.slice(0, 8)}</span>
                        ) : row.isPurchaseReceipt ? (
                          <span className="small muted">Correct through Purchasing</span>
                        ) : row.canReverse ? (
                          <button
                            className="text-button"
                            disabled={openingPreview}
                            onClick={async () => {
                              setOpeningPreview(true);
                              setError('');
                              try {
                                const preview = await api.stockReversalPreview(row.id);
                                setReversalPreview(preview);
                                setReversing(row);
                              } catch (err) {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : 'Unable to preview reversal.',
                                );
                              } finally {
                                setOpeningPreview(false);
                              }
                            }}
                          >
                            Reverse posting
                          </button>
                        ) : null}
                      </footer>
                    </article>
                  ))
                ) : (
                  <div className="inventory-empty">
                    <h3>No movements found</h3>
                    <p>Posted receipts, transfers and corrections appear here.</p>
                  </div>
                )}
              </div>
            )}
            {!!data?.total && !loading && !error && (
              <footer className="inventory-pagination">
                <span>
                  {data.total} {tab === 'stock' ? 'SKUs' : 'postings'} · Page {page} of {totalPages}
                </span>
                <div>
                  <button
                    className="secondary-button"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="secondary-button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </footer>
            )}
          </section>
          <p className="muted small">
            On hand is physical stock. Available excludes active sales stock holds. Holds expire at
            their recorded time; refresh to see current availability. Stock value and low-stock
            thresholds are later workflows.
          </p>
        </>
      )}
      {location && (action || reversing) && (
        <PostingDialog
          api={api}
          kind={action ?? 'adjustment'}
          location={location}
          locations={locations}
          reversing={reversing}
          reversalPreview={reversalPreview}
          onClose={() => {
            setAction(null);
            setReversing(undefined);
          }}
          onSaved={done}
        />
      )}
      {locationOpen && (
        <LocationDialog
          api={api}
          onClose={() => setLocationOpen(false)}
          onSaved={() => {
            setLocationOpen(false);
            setLocationRevision((n) => n + 1);
            setNotice('Location created. You can now record stock.');
          }}
        />
      )}
    </div>
  );
}
