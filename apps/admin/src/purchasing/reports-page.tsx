import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { AgingCards, agingLabels } from './report-cards';
import { ReportSupplierPicker } from './report-supplier-picker';
import { SupplierStatementDialog } from './statement-dialog';
import { money } from './money';
import type { AgingReport } from './report-types';
export function PayablesReports({ api, onBack }: { api: StaffApi; onBack: () => void }) {
  const [data, setData] = useState<AgingReport | null>(null),
    [asOf, setAsOf] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState<{ asOf?: string; search: string }>({ search: '' }),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [supplierId, setSupplierId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    void api
      .payableAging({ ...query, page })
      .then((d) => {
        if (active) {
          setData(d);
          setAsOf((v) => v || d.asOf);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load aging report.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, query, page, revision]);
  return (
    <div className="purchasing-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR RECORDED PAYABLES</span>
          <h1 id="page-title" tabIndex={-1}>
            Statements & aging
          </h1>
          <p>See what remains outstanding, and when each amount became due.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>
          Back to purchasing
        </button>
      </div>
      <p className="inventory-guidance">
        Balances cover invoices and payments recorded here, including inactive suppliers. Older
        cutoffs filter the stored recorded timestamps. Opening balances from other systems and
        supplier credits are not included.
      </p>
      <section className="panel inventory-content">
        <form
          className="invoice-directory-toolbar inventory-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (loading) return;
            if (!asOf) {
              setError('Choose a report date.');
              return;
            }
            setPage(1);
            setQuery({ asOf, search: search.trim() });
          }}
        >
          <label>
            Aging as of
            <input
              type="date"
              value={asOf}
              min="2000-01-01"
              max={data?.today}
              required
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
          <label>
            Filter suppliers
            <input
              type="search"
              value={search}
              maxLength={100}
              placeholder="Supplier name or code"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button className="secondary-button" disabled={loading}>
            Apply aging filters
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Refresh aging
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status" className="invoice-summary">
            Loading aging report…
          </p>
        ) : (
          data && (
            <>
              <div className="aging-overview">
                <p>As of {data.asOf} · BDT · Bangladesh time</p>
                <strong>{money(data.totals.outstanding)}</strong>
                <p>
                  {data.totals.supplierCount} suppliers · {data.totals.invoiceCount} outstanding
                  invoices matching these filters
                </p>
                <AgingCards totals={data.totals} />
              </div>
              {!data.total ? (
                <p className="invoice-summary">
                  No outstanding recorded invoices match this cutoff and search.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="aging-table">
                    <caption className="sr-only">Supplier aging report</caption>
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Outstanding</th>
                        {agingLabels.map(([key, label]) => (
                          <th key={key}>{label}</th>
                        ))}
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.name}
                            <small>
                              {s.code}
                              {s.isActive ? '' : ' · Inactive'}
                            </small>
                          </td>
                          <td>{money(s.outstanding)}</td>
                          {agingLabels.map(([key]) => (
                            <td key={key}>{money(s[key])}</td>
                          ))}
                          <td>
                            <button
                              className="secondary-button"
                              onClick={() => setSupplierId(s.id)}
                            >
                              Statement for {s.code}
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
                  Page {page} of {Math.max(1, Math.ceil(data.total / 20))}
                </span>
                <button
                  className="secondary-button"
                  disabled={page === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous suppliers
                </button>
                <button
                  className="secondary-button"
                  disabled={page * 20 >= data.total}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next suppliers
                </button>
              </div>
              <p className="invoice-summary report-context">
                Generated{' '}
                {new Date(data.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}.
                Totals include every matching supplier, not just this page.
              </p>
            </>
          )
        )}
      </section>
      <ReportSupplierPicker api={api} onSelect={setSupplierId} />
      {supplierId && (
        <SupplierStatementDialog
          api={api}
          supplierId={supplierId}
          initialTo={data?.asOf ?? query.asOf}
          onClose={() => setSupplierId(null)}
        />
      )}
    </div>
  );
}
