import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { PaymentWorkspace } from './payment-workspace';
import { money } from './money';
import type { PaymentList, PaymentSupplier } from './payment-types';
export function PaymentListView({ api, onBack }: { api: StaffApi; onBack: () => void }) {
  const [data, setData] = useState<PaymentList | null>(null),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [supplierId, setSupplierId] = useState<string | null>(null),
    [supplierSearch, setSupplierSearch] = useState(''),
    [suppliers, setSuppliers] = useState<PaymentSupplier[]>([]),
    [supplierLoading, setSupplierLoading] = useState(true),
    [supplierError, setSupplierError] = useState('');
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
      .supplierPayments({ search: query, status, page })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load payments.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, query, status, page, revision]);
  useEffect(() => {
    let active = true;
    setSupplierLoading(true);
    setSupplierError('');
    setSuppliers([]);
    const timer = window.setTimeout(() => {
      void api
        .paymentSuppliers(supplierSearch.trim())
        .then((d) => {
          if (active) setSuppliers(d);
        })
        .catch((e) => {
          if (active)
            setSupplierError(e instanceof Error ? e.message : 'Unable to find suppliers.');
        })
        .finally(() => {
          if (active) setSupplierLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, supplierSearch, revision]);
  return (
    <div className="purchasing-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SUPPLIER PAYMENTS</span>
          <h1 id="page-title" tabIndex={-1}>
            Supplier payments
          </h1>
          <p>Record payments, match invoices and keep every correction traceable.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>
          Back to purchasing
        </button>
      </div>
      <p className="inventory-guidance">
        These records track payments already made. They do not send money or show a bank/cash
        account balance.
      </p>
      <section className="panel payment-supplier-picker">
        <h2>Open a supplier</h2>
        <label>
          Find supplier with recorded invoices
          <input
            type="search"
            maxLength={100}
            value={supplierSearch}
            placeholder="Supplier name or code"
            onChange={(e) => setSupplierSearch(e.target.value)}
          />
        </label>
        {supplierError && (
          <p className="form-error" role="alert">
            {supplierError}
          </p>
        )}
        {supplierLoading ? (
          <p role="status">Finding suppliers…</p>
        ) : (
          <div className="payment-supplier-results">
            {suppliers.map((s) => (
              <button className="secondary-button" key={s.id} onClick={() => setSupplierId(s.id)}>
                {s.name}
                <small>
                  {s.code}
                  {s.isActive ? '' : ' · Inactive'}
                </small>
              </button>
            ))}
            {!suppliers.length && (
              <p>No matching supplier with recorded invoices. Record a supplier invoice first.</p>
            )}
          </div>
        )}
      </section>
      <section className="panel inventory-content">
        <div className="inventory-toolbar invoice-directory-toolbar">
          <label>
            Search payments
            <input
              type="search"
              value={search}
              maxLength={100}
              placeholder="Payment reference or supplier"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Payment status
            <select
              aria-label="Payment status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All payments</option>
              <option value="active">Recorded</option>
              <option value="reversed">Reversed</option>
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Refresh payment list
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading payments…</p>
        ) : (
          data && (
            <>
              <p className="invoice-summary">
                <strong>{money(data.recorded)}</strong> active recorded payments matching these
                filters
              </p>
              {!data.total ? (
                <p className="invoice-summary">No matching payment records.</p>
              ) : (
                <div className="table-scroll">
                  <table className="purchase-table">
                    <caption className="sr-only">Supplier payments</caption>
                    <thead>
                      <tr>
                        <th>Reference / Paid on</th>
                        <th>Supplier</th>
                        <th>Method / Source</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.reference}
                            <small>{p.paidOn}</small>
                          </td>
                          <td>{p.supplierName}</td>
                          <td>
                            {p.method}
                            <small>{p.source}</small>
                          </td>
                          <td>{money(p.amount)}</td>
                          <td>{p.reversedAt ? 'Reversed' : 'Recorded'}</td>
                          <td>
                            <button
                              className="secondary-button"
                              onClick={() => setSupplierId(p.supplierId)}
                            >
                              Open payments for {p.supplierName}
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
                  {data.total} payments · Page {page} of {Math.max(1, Math.ceil(data.total / 20))}
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
      {supplierId && (
        <PaymentWorkspace
          api={api}
          supplierId={supplierId}
          onClose={() => setSupplierId(null)}
          onChanged={() => setRevision((n) => n + 1)}
        />
      )}
    </div>
  );
}
