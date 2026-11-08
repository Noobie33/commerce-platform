import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { money } from './money';
import { AgingCards, agingLabels } from './report-cards';
import type { SupplierStatement, StatementEvent } from './report-types';
const names: Record<StatementEvent['kind'], string> = {
  invoice: 'Invoice recorded',
  payment: 'Payment recorded',
  invoice_reversal: 'Invoice reversed',
  payment_reversal: 'Payment reversed',
};
export function SupplierStatementDialog({
  api,
  supplierId,
  initialTo,
  onClose,
}: {
  api: StaffApi;
  supplierId: string;
  initialTo?: string | undefined;
  onClose: () => void;
}) {
  const [data, setData] = useState<SupplierStatement | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(initialTo ?? ''),
    [query, setQuery] = useState<{ from?: string; to?: string }>(
      initialTo ? { to: initialTo } : {},
    ),
    [page, setPage] = useState(1),
    [invoicePage, setInvoicePage] = useState(1),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    void api
      .supplierStatement(supplierId, { ...query, page, invoicePage })
      .then((d) => {
        if (active) {
          setData(d);
          setFrom((v) => v || d.from);
          setTo((v) => v || d.to);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load statement.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, supplierId, query, page, invoicePage, revision]);
  const unapplied = !!data && (from !== data.from || to !== data.to);
  async function download() {
    if (!data) return;
    setExporting(true);
    setError('');
    try {
      const blob = await api.supplierStatementCsv(supplierId, { from: data.from, to: data.to }),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = 'supplier-statement-' + data.supplier.code + '-' + data.to + '.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to download the statement.');
    } finally {
      setExporting(false);
    }
  }
  return (
    <Dialog
      title="Supplier statement & aging"
      subtitle={
        data ? data.supplier.name + ' · ' + data.supplier.code : 'Recorded invoices and payments'
      }
      onClose={() => {
        if (!exporting) onClose();
      }}
      wide
    >
      <div className="dialog-body report-statement">
        <p className="inventory-guidance">
          This report follows when entries were recorded, rather than the document date. Entries
          with recorded timestamps after the cutoff are excluded. Balances cover records here;
          opening balances from other systems, advances and supplier credits are not included.
        </p>
        <form
          className="report-filters"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (loading || exporting) return;
            if (!from || !to || from > to) {
              setError('Choose a valid start and end date.');
              return;
            }
            setPage(1);
            setInvoicePage(1);
            setQuery({ from, to });
          }}
        >
          <label>
            Statement from
            <input
              type="date"
              required
              value={from}
              min="2000-01-01"
              max={to || data?.today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Statement to
            <input
              type="date"
              required
              value={to}
              min={from || '2000-01-01'}
              max={data?.today}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button className="secondary-button" disabled={loading || exporting}>
            Apply period
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading statement…</p>
        ) : (
          data && (
            <>
              <p className="report-context">
                {data.from} to {data.to} · BDT · Bangladesh time · Generated{' '}
                {new Date(data.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}
              </p>
              {!data.supplier.isActive && <p>Inactive supplier · recorded history is retained.</p>}
              <div className="report-summary">
                {(
                  [
                    ['opening', 'Brought forward from records'],
                    ['increased', 'Increases this period'],
                    ['decreased', 'Reductions this period'],
                    ['closing', 'Closing recorded balance'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <strong>{money(data.totals[key])}</strong>
                  </div>
                ))}
              </div>
              <h3>Outstanding at {data.to}</h3>
              <AgingCards totals={data.totals} />
              <p>
                Days past due use the invoice due date. Due today is included in “Not due / due
                today”.
              </p>
              {!data.invoicesTotal ? (
                <p>No outstanding amounts on recorded invoices at this cutoff.</p>
              ) : (
                <div className="table-scroll">
                  <table className="purchase-table">
                    <caption className="sr-only">Outstanding invoices at cutoff</caption>
                    <thead>
                      <tr>
                        <th>Invoice / PO</th>
                        <th>Due</th>
                        <th>Total</th>
                        <th>Paid at cutoff</th>
                        <th>Remaining</th>
                        <th>Days past due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.invoices.map((i) => (
                        <tr key={i.id}>
                          <td>
                            {i.number}
                            <small>{i.orderNumber}</small>
                          </td>
                          <td>{i.dueOn}</td>
                          <td>{money(i.total)}</td>
                          <td>{money(i.paid)}</td>
                          <td>{money(i.remaining)}</td>
                          <td>{i.daysOverdue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.invoicesTotal > 25 && (
                <div className="inventory-pagination">
                  <span>
                    Invoice page {invoicePage} of {Math.ceil(data.invoicesTotal / 25)}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={invoicePage === 1}
                    onClick={() => setInvoicePage((n) => n - 1)}
                  >
                    Previous report invoices
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={invoicePage * 25 >= data.invoicesTotal}
                    onClick={() => setInvoicePage((n) => n + 1)}
                  >
                    Next report invoices
                  </button>
                </div>
              )}
              <h3>Recorded activity</h3>
              <p>
                Amounts increase or reduce what is payable. Entries sharing a recorded timestamp
                show that group’s closing balance.
              </p>
              {!data.items.length ? (
                <p>
                  No entries were recorded during this period. The brought-forward balance still
                  applies.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="statement-table">
                    <caption className="sr-only">Recorded supplier activity</caption>
                    <thead>
                      <tr>
                        <th>Recorded / Document date</th>
                        <th>Entry / Reference</th>
                        <th>Increase</th>
                        <th>Decrease</th>
                        <th>Balance at recorded time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((e) => (
                        <tr key={e.id}>
                          <td>
                            {new Date(e.recordedAt).toLocaleString('en-GB', {
                              timeZone: 'Asia/Dhaka',
                            })}
                            <small>Document {e.documentOn}</small>
                          </td>
                          <td>
                            <strong>{names[e.kind]}</strong>
                            <small>{e.reference}</small>
                            <details>
                              <summary>Reason & actor</summary>
                              <p>{e.reason}</p>
                              <small>{e.actorName}</small>
                            </details>
                          </td>
                          <td>{money(e.increase)}</td>
                          <td>{money(e.decrease)}</td>
                          <td>
                            {money(e.balanceAtTime)}
                            {e.sameTimeEvents > 1 && (
                              <small>{e.sameTimeEvents} entries at this time</small>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.total > 20 && (
                <div className="inventory-pagination">
                  <span>
                    Activity page {page} of {Math.ceil(data.total / 20)}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={page === 1}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    Previous statement entries
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={page * 20 >= data.total}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Next statement entries
                  </button>
                </div>
              )}
              <p className="report-context">
                Supplier header uses the current directory. Historical balances use entries dated by
                the selected recorded-time cutoff.
              </p>
            </>
          )
        )}
      </div>
      <footer className="dialog-footer statement-footer">
        <button type="button" className="secondary-button" disabled={exporting} onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || exporting}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh statement
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!data || loading || exporting || unapplied}
          title={unapplied ? 'Apply the period before downloading' : undefined}
          onClick={() => {
            void download();
          }}
        >
          {exporting ? 'Preparing CSV…' : 'Download CSV'}
        </button>
      </footer>
    </Dialog>
  );
}
