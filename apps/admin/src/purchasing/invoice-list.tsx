import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { InvoicePanel } from './invoice-panel';
import { money } from './money';
import type { InvoiceList } from './invoice-types';
export function InvoiceListView({ api, onBack }: { api: StaffApi; onBack: () => void }) {
  const [data, setData] = useState<InvoiceList | null>(null),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [orderId, setOrderId] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    void api
      .supplierInvoices({ search: query, status, page })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load invoices.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, query, status, page, revision]);
  return (
    <div className="purchasing-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SUPPLIER DOCUMENTS</span>
          <h1 id="page-title" tabIndex={-1}>
            Supplier invoices
          </h1>
          <p>Recorded invoices, due dates and a complete correction history.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>
          Back to purchasing
        </button>
      </div>
      <p className="inventory-guidance">
        Record invoices after receiving goods. Recorded payments reduce the remaining amounts;
        opening balances are not included yet.
      </p>
      <section className="panel inventory-content">
        <div className="inventory-toolbar invoice-directory-toolbar">
          <label>
            Search invoices
            <input
              type="search"
              value={search}
              maxLength={100}
              placeholder="Invoice, supplier or purchase order"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Invoice status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All invoices</option>
              <option value="active">Active invoices</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="reversed">Reversed</option>
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Refresh invoice list
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading supplier invoices…</p>
        ) : (
          data && (
            <>
              <p className="invoice-summary">
                <strong>{money(data.unsettled)}</strong> outstanding on recorded invoices matching
                these filters
              </p>
              {data.total === 0 ? (
                <p>
                  No matching invoices. Try another search or status. New invoices are recorded from
                  received purchase orders.
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">Supplier invoices</caption>
                    <thead>
                      <tr>
                        <th>Invoice / Order</th>
                        <th>Supplier</th>
                        <th>Due</th>
                        <th>Total</th>
                        <th>Paid / Remaining</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((i) => (
                        <tr key={i.id}>
                          <td>
                            {i.number}
                            <small>{i.orderNumber}</small>
                          </td>
                          <td>{i.supplierName}</td>
                          <td>{i.dueOn}</td>
                          <td>{money(i.total)}</td>
                          <td>
                            {money(i.paid)} / {money(i.remaining)}
                          </td>
                          <td>
                            {i.reversedAt
                              ? 'Reversed'
                              : i.remaining === '0.00'
                                ? 'Paid'
                                : i.paid === '0.00'
                                  ? 'Unpaid'
                                  : 'Partially paid'}
                          </td>
                          <td>
                            <button
                              className="secondary-button"
                              onClick={() => setOrderId(i.orderId)}
                            >
                              Open invoices for {i.orderNumber}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="inventory-pagination">
                <span>
                  {data.total} invoices · Page {page} of {Math.max(1, Math.ceil(data.total / 20))}
                </span>
                <button
                  className="secondary-button"
                  disabled={page === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  disabled={page * 20 >= data.total}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )
        )}
      </section>
      {orderId && (
        <Dialog title="Order invoices" onClose={() => setOrderId(null)} wide>
          <div className="dialog-body">
            <InvoicePanel api={api} orderId={orderId} onChanged={() => setRevision((n) => n + 1)} />
          </div>
          <footer className="dialog-footer">
            <button className="secondary-button" onClick={() => setOrderId(null)}>
              Close
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
