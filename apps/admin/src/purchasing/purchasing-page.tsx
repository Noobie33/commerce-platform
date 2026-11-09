import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import { PayablesReports } from './reports-page';
import { PaymentListView } from './payment-list';
import { InvoiceListView } from './invoice-list';
import { useCallback, useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Icon } from '../icons';
import { SupplierDialog } from './supplier-dialog';
import { OrderEditor } from './order-editor';
import { OrderDetail } from './order-detail';
import { money } from './money';
import type { Supplier, PurchaseOrder, Page } from './types';
import './purchasing.css';
export function PurchasingPage({
  api,
  canManage,
  canViewInvoices,
}: {
  api: StaffApi;
  canManage: boolean;
  canViewInvoices: boolean;
}) {
  const [tab, setTab] = useState<'orders' | 'suppliers' | 'invoices' | 'payments' | 'reports'>(
      'orders',
    ),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState(false),
    [actionError, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [supplierDialog, setSupplierDialog] = useState<{ initial: Supplier | null } | null>(null),
    [editor, setEditor] = useState<{ initial: PurchaseOrder | null } | null>(null),
    [detail, setDetail] = useState<PurchaseOrder | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => setError(''), [tab, query, status, page, revision]);
  const read = useLiveRead(
    useCallback(
      async (options) => {
        const [locations, result] = await Promise.all([
          api.purchaseLocations(options),
          tab === 'orders'
            ? api.purchaseOrders({ search: query, status, page }, options)
            : api.suppliers({ search: query, status, page }, options),
        ]);
        return { locations, result };
      },
      [api, tab, query, status, page],
    ),
    {
      topics: ['purchasing'],
      revision,
      enabled: tab === 'orders' || tab === 'suppliers',
      paused: !!(supplierDialog || editor || detail),
    },
  );
  const locations = read.data?.locations ?? [],
    orders =
      tab === 'orders' ? ((read.data?.result as Page<PurchaseOrder> | undefined) ?? null) : null,
    suppliers =
      tab === 'suppliers' ? ((read.data?.result as Page<Supplier> | undefined) ?? null) : null,
    loading = read.loading,
    error = read.error || actionError;
  useEffect(() => {
    if (read.data) {
      const last = Math.max(1, Math.ceil(read.data.result.total / 20));
      if (page > last) setPage(last);
    }
  }, [read.data, page]);
  const total = (tab === 'orders' ? orders : suppliers)?.total ?? 0,
    totalPages = Math.max(1, Math.ceil(total / 20));
  const savedOrder = (order: PurchaseOrder) => {
    setEditor(null);
    setDetail(order);
    setNotice(
      order.status === 'draft'
        ? 'Purchase order draft saved. Stock has not changed.'
        : order.status === 'issued'
          ? 'Order issued. Its supplier and product details are preserved.'
          : 'Order cancelled. Its history remains available.',
    );
    setRevision((r) => r + 1);
  };
  async function openOrder(id: string) {
    setOpening(true);
    setError('');
    try {
      setDetail(await api.purchaseOrder(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open order.');
    } finally {
      setOpening(false);
    }
  }
  async function openSupplier(id: string) {
    setOpening(true);
    setError('');
    try {
      setSupplierDialog({ initial: await api.supplier(id) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open supplier.');
    } finally {
      setOpening(false);
    }
  }
  if (tab === 'reports') return <PayablesReports api={api} onBack={() => setTab('orders')} />;
  if (tab === 'payments') return <PaymentListView api={api} onBack={() => setTab('orders')} />;
  if (tab === 'invoices') return <InvoiceListView api={api} onBack={() => setTab('orders')} />;
  return (
    <div className="purchasing-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SUPPLY NETWORK</span>
          <h1 id="page-title" tabIndex={-1}>
            Purchasing
          </h1>
          <p>Organise suppliers. Plan purchases. Keep every order traceable.</p>
        </div>
        <div className="purchase-heading-actions">
          {canViewInvoices && (
            <button className="secondary-button" onClick={() => setTab('reports')}>
              Statements & aging
            </button>
          )}
          {canViewInvoices && (
            <button className="secondary-button" onClick={() => setTab('payments')}>
              Supplier payments
            </button>
          )}
          {canViewInvoices && (
            <button className="secondary-button" onClick={() => setTab('invoices')}>
              Supplier invoices
            </button>
          )}
          {canManage && (
            <button
              className="primary-button"
              disabled={opening || loading}
              onClick={() => {
                setNotice('');
                if (tab === 'orders') setEditor({ initial: null });
                else setSupplierDialog({ initial: null });
              }}
            >
              {tab === 'orders' ? 'New purchase order' : 'New supplier'} <Icon name="plus" />
            </button>
          )}
        </div>
      </div>
      <ReadStatus read={read} />

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="purchase-stage-note">
        <Icon name="catalog" />
        <div>
          <strong>Order first. Receive separately.</strong>
          <p>
            Purchase orders track planned buying. Stock receipts, supplier bills and payments are
            separate steps.
          </p>
        </div>
      </div>
      <section className="panel inventory-content">
        <div className="inventory-toolbar">
          <div className="inventory-tabs" role="group" aria-label="Purchasing view">
            {(['orders', 'suppliers'] as const).map((value) => (
              <button
                key={value}
                aria-pressed={tab === value}
                disabled={opening}
                onClick={() => {
                  setTab(value);
                  setStatus('all');
                  setPage(1);
                  setSearch('');
                  setQuery('');
                  setNotice('');
                }}
              >
                {value === 'orders' ? 'Purchase orders' : 'Suppliers'}
              </button>
            ))}
          </div>
          <div className="inventory-filters">
            <label htmlFor="purchasing-search" className="sr-only">
              Search purchasing
            </label>
            <input
              id="purchasing-search"
              type="search"
              maxLength={100}
              value={search}
              placeholder={
                tab === 'orders'
                  ? 'Search order, supplier or reference'
                  : 'Search supplier, code or phone'
              }
              onChange={(e) => setSearch(e.target.value)}
            />
            <label htmlFor="purchasing-status" className="sr-only">
              Purchasing status
            </label>
            <select
              id="purchasing-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              {(tab === 'orders' ? ['draft', 'issued', 'cancelled'] : ['active', 'inactive']).map(
                (s) => (
                  <option key={s} value={s}>
                    {s[0]!.toUpperCase() + s.slice(1)}
                  </option>
                ),
              )}
            </select>
            <button
              className="icon-button"
              aria-label="Refresh purchasing"
              disabled={loading || read.refreshing}
              onClick={() => setRevision((n) => n + 1)}
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
            Loading purchasing…
          </div>
        ) : !total ? (
          <div className="inventory-empty">
            <Icon name="catalog" />
            <h2>
              {query || status !== 'all'
                ? 'No matches found'
                : tab === 'orders'
                  ? 'Plan your next purchase'
                  : 'Build your supplier directory'}
            </h2>
            <p>
              {query || status !== 'all'
                ? 'Try another search or status.'
                : tab === 'orders'
                  ? 'Add an active supplier and delivery location, then prepare your first purchase order.'
                  : 'Store supplier contact details once and reuse them across purchase orders.'}
            </p>
            {canManage && !query && status === 'all' && (
              <button
                className="secondary-button"
                onClick={() =>
                  tab === 'orders'
                    ? setEditor({ initial: null })
                    : setSupplierDialog({ initial: null })
                }
              >
                {tab === 'orders' ? 'Create purchase order' : 'Add first supplier'}
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <p className="purchase-scroll-hint">Scroll sideways to view all columns.</p>
            <table className="inventory-table purchase-table">
              <caption className="sr-only">
                {tab === 'orders' ? 'Purchase orders' : 'Supplier directory'}
              </caption>
              <thead>
                {tab === 'orders' ? (
                  <tr>
                    <th>Purchase order</th>
                    <th>Supplier / Delivery</th>
                    <th>Status</th>
                    <th>Goods subtotal</th>
                    <th>Expected on</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                ) : (
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                )}
              </thead>
              <tbody>
                {tab === 'orders'
                  ? orders?.items.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.number}</strong>
                          <small>{new Date(o.createdAt).toLocaleDateString()}</small>
                        </td>
                        <td>
                          <strong>{o.supplierName}</strong>
                          <small>{o.locationName}</small>
                        </td>
                        <td>
                          <span className={'badge purchase-status-' + o.status}>{o.status}</span>
                        </td>
                        <td className="purchase-money">{money(o.total)}</td>
                        <td>{o.expectedOn ?? '—'}</td>
                        <td>
                          <button
                            className="text-button"
                            disabled={opening}
                            aria-label={'Open ' + o.number}
                            onClick={() => void openOrder(o.id)}
                          >
                            View order <Icon name="arrow" />
                          </button>
                        </td>
                      </tr>
                    ))
                  : suppliers?.items.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                          <small>{s.code}</small>
                        </td>
                        <td>
                          {s.contactName || '—'}
                          <small>{s.phone || s.email || 'No contact details added'}</small>
                        </td>
                        <td>
                          <span
                            className={
                              'badge ' +
                              (s.isActive ? 'purchase-status-issued' : 'purchase-status-cancelled')
                            }
                          >
                            {s.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>{new Date(s.updatedAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            className="text-button"
                            disabled={opening}
                            aria-label={'Open supplier ' + s.name}
                            onClick={() => void openSupplier(s.id)}
                          >
                            View supplier <Icon name="arrow" />
                          </button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {!!total && !loading && !error && (
          <footer className="inventory-pagination">
            <span>
              {total} {tab === 'orders' ? 'orders' : 'suppliers'} · Page {page} of {totalPages}
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
      {supplierDialog && (
        <SupplierDialog
          api={api}
          initial={supplierDialog.initial}
          canManage={canManage}
          onClose={() => setSupplierDialog(null)}
          onSaved={() => {
            setSupplierDialog(null);
            setNotice('Supplier saved. Issued order details stay unchanged.');
            setRevision((n) => n + 1);
          }}
        />
      )}
      {editor && (
        <OrderEditor
          api={api}
          initial={editor.initial}
          locations={locations}
          onClose={() => setEditor(null)}
          onSaved={savedOrder}
        />
      )}
      {detail && (
        <OrderDetail
          key={detail.id + ':' + detail.version}
          api={api}
          order={detail}
          canManage={canManage}
          canViewInvoices={canViewInvoices}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor({ initial: detail });
            setDetail(null);
          }}
          onSaved={savedOrder}
        />
      )}
    </div>
  );
}
