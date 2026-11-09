import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import type { SalesOrder, SalesLocation } from './types';
import { SalesEditor } from './sales-editor';
import { SalesDetail } from './sales-detail';
import { CancelDraft } from './cancel-draft';
import { money, problem } from './helpers';
import './sales.css';
export function SalesPage({ api, canManage }: { api: StaffApi; canManage: boolean }) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [locations, setLocations] = useState<SalesLocation[]>([]),
    [actionError, setError] = useState(''),
    [locationError, setLocationError] = useState(''),
    [notice, setNotice] = useState(''),
    [detail, setDetail] = useState<SalesOrder | null>(null),
    [editor, setEditor] = useState<SalesOrder | 'new' | null>(null),
    [cancel, setCancel] = useState<SalesOrder | null>(null);
  const opening = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);

    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setError(''), [query, status, page, revision]);
  const read = useLiveRead(
    useCallback(
      (options) => api.salesOrders({ search: query, status, page }, options),
      [api, query, status, page],
    ),
    { revision, paused: !!(detail || editor || cancel) },
  );
  const data = read.data,
    loading = read.loading,
    error = read.error || actionError;
  useEffect(() => {
    if (data) {
      const last = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > last) setPage(last);
    }
  }, [data, page]);
  useEffect(() => {
    let live = true;
    setLocationError('');
    void api
      .salesLocations()
      .then((r) => {
        if (live) setLocations(r);
      })
      .catch((e) => {
        if (live) setLocationError(problem(e));
      });
    return () => {
      live = false;
    };
  }, [api, revision]);
  async function open(id: string) {
    const token = ++opening.current;
    setError('');
    try {
      const order = await api.salesOrder(id);
      if (token === opening.current) setDetail(order);
    } catch (e) {
      if (token === opening.current) setError(problem(e));
    }
  }
  function saved(r: { id: string }, message: string) {
    setEditor(null);
    setCancel(null);
    setNotice(message);
    refresh((n) => n + 1);
    void open(r.id);
  }
  return (
    <section className="sales-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RETAIL SALES</span>
          <h1 id="page-title" tabIndex={-1}>
            Sales orders
          </h1>
          <p>Prepare clear, accurate orders for your customers.</p>
        </div>
        <div className="sales-actions">
          <button
            className="secondary-button"
            disabled={loading || read.refreshing}
            onClick={() => refresh((n) => n + 1)}
          >
            Refresh
          </button>
          {canManage && (
            <button
              className="primary-button"
              disabled={!locations.length}
              onClick={() => setEditor('new')}
            >
              + New sales draft
            </button>
          )}
        </div>
      </div>
      <ReadStatus read={read} />

      {notice && (
        <p className="sales-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {locationError && (
        <p className="form-error" role="alert">
          {locationError} Refresh to reload locations.
        </p>
      )}
      {canManage && !locationError && !locations.length && (
        <p className="sales-warning">
          Add an active warehouse or store in Inventory before preparing sales orders.
        </p>
      )}
      <div className="sales-toolbar">
        <label>
          Search orders
          <input
            maxLength={140}
            value={search}
            placeholder="Order number, customer or reference"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Order status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <div className="sales-panel" aria-busy={loading}>
        <div className="sales-panel-heading">
          <h2>Order workspace</h2>
          <span>{loading ? 'Loading…' : `${data?.total ?? 0} matching orders`}</span>
        </div>
        {!loading && !error && data?.items.length === 0 ? (
          <div className="sales-empty">
            <h3>No orders in this view</h3>
            <p>Prepare a draft or adjust the search and filters.</p>
          </div>
        ) : (
          <div
            className="sales-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Sales order table"
          >
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Channel / location</th>
                  <th>Goods total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button className="sales-link" onClick={() => void open(o.id)}>
                        {o.number}
                      </button>
                      <small>{o.reference || 'No customer reference'}</small>
                    </td>
                    <td>
                      {o.customerName}
                      <small>{o.customerSnapshot.code}</small>
                    </td>
                    <td>
                      {o.channel === 'retail' ? 'Retail' : 'Archived wholesale'}
                      <small>{o.locationName}</small>
                    </td>
                    <td>{money(o.total)}</td>
                    <td>
                      <span className={'sales-badge ' + o.status}>
                        {o.status === 'draft' ? 'Draft' : 'Cancelled'}
                      </span>
                      {o.stockReserved && <small>Stock held</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="sales-pagination">
          <span>
            Page {page} of {Math.max(1, Math.ceil((data?.total ?? 0) / 20))}
          </span>
          <div>
            <button
              className="secondary-button"
              disabled={loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="secondary-button"
              disabled={loading || page * 20 >= (data?.total ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      <p className="sales-hint">
        Saving a draft alone does not reserve stock or create receivables. Open an order to manage
        timed stock holds. Confirmation, fulfillment and invoicing are later workflows.
      </p>
      {detail && (
        <SalesDetail
          api={api}
          refresh={async () => {
            setDetail(await api.salesOrder(detail.id));
            refresh((n) => n + 1);
          }}
          order={detail}
          close={() => setDetail(null)}
          canManage={canManage}
          edit={() => {
            setEditor(detail);
            setDetail(null);
          }}
          cancel={() => {
            setCancel(detail);
            setDetail(null);
          }}
        />
      )}
      {editor && (
        <SalesEditor
          api={api}
          initial={editor === 'new' ? null : editor}
          locations={locations}
          close={() => setEditor(null)}
          saved={(r) => saved(r, 'Sales draft saved.')}
        />
      )}
      {cancel && (
        <CancelDraft
          api={api}
          order={cancel}
          close={() => setCancel(null)}
          saved={(r) => saved(r, 'Sales draft cancelled. History retained.')}
        />
      )}
    </section>
  );
}
