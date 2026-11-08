import { SupplierStatementDialog } from './statement-dialog';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { PaymentDialog } from './payment-dialog';
import { money } from './money';
import type { SupplierPayment, SupplierPaymentPage } from './payment-types';
export function PaymentWorkspace({
  api,
  supplierId,
  onClose,
  onChanged,
}: {
  api: StaffApi;
  supplierId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [statement, setStatement] = useState(false);
  const [data, setData] = useState<SupplierPaymentPage | null>(null),
    [page, setPage] = useState(1),
    [invoicePage, setInvoicePage] = useState(1),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [action, setAction] = useState<{ reversing?: SupplierPayment } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .supplierPaymentPage(supplierId, page, invoicePage)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setError(e instanceof Error ? e.message : 'Unable to load supplier payments.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, supplierId, page, invoicePage, revision]);
  return (
    <Dialog
      title="Supplier payments"
      subtitle={
        data ? data.supplier.name + ' · ' + data.supplier.code : 'Invoices and payment history'
      }
      onClose={onClose}
      wide
    >
      <div className="dialog-body payment-workspace">
        <p className="inventory-guidance">
          Balances cover invoices and payments recorded here. Opening balances, advances, supplier
          credits and accounting journals are not included.
        </p>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading supplier payments…</p>
        ) : (
          data && (
            <>
              {!data.supplier.isActive && (
                <p>Inactive supplier — payments against existing invoices remain available.</p>
              )}
              <div className="payment-summary">
                <div>
                  <span>Active invoices</span>
                  <strong>{money(data.invoiceTotal)}</strong>
                </div>
                <div>
                  <span>Recorded paid</span>
                  <strong>{money(data.paid)}</strong>
                </div>
                <div>
                  <span>Outstanding</span>
                  <strong>{money(data.outstanding)}</strong>
                </div>
              </div>
              {data.canRecord && data.invoices.length > 0 && (
                <button type="button" className="primary-button" onClick={() => setAction({})}>
                  Record payment
                </button>
              )}
              <h3>Outstanding invoices</h3>
              {!data.invoicesTotal ? (
                <p>No outstanding amounts on recorded invoices.</p>
              ) : (
                <div className="table-scroll">
                  <table className="purchase-table">
                    <caption className="sr-only">Outstanding supplier invoices</caption>
                    <thead>
                      <tr>
                        <th>Invoice / PO</th>
                        <th>Due</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Remaining</th>
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
                    Previous unpaid invoices
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={invoicePage * 25 >= data.invoicesTotal}
                    onClick={() => setInvoicePage((n) => n + 1)}
                  >
                    Next unpaid invoices
                  </button>
                </div>
              )}
              <h3>Payment history</h3>
              {!data.items.length ? (
                <p>No payments recorded for this supplier.</p>
              ) : (
                data.items.map((p) => (
                  <article className="payment-history-card" key={p.id}>
                    <div className="receipt-heading">
                      <h4>{p.reference}</h4>
                      <strong>{money(p.amount)}</strong>
                    </div>
                    <p>
                      {p.reversedAt ? 'Reversed' : 'Recorded'} · {p.paidOn} · {p.method} ·{' '}
                      {p.source}
                    </p>
                    <p>
                      {p.actorName} · {p.reason}
                    </p>
                    <details>
                      <summary>Allocated invoices</summary>
                      <ul>
                        {p.allocations.map((a) => (
                          <li key={a.invoiceId}>
                            {a.number} · {a.orderNumber} · {money(a.amount)}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {p.reversedAt ? (
                      <p>
                        Reversed {new Date(p.reversedAt).toLocaleString()} · {p.reversalReason}
                      </p>
                    ) : (
                      data.canReverse && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setAction({ reversing: p })}
                        >
                          Reverse payment {p.reference}
                        </button>
                      )
                    )}
                  </article>
                ))
              )}
              {data.total > 20 && (
                <div className="inventory-pagination">
                  <span>
                    Payment page {page} of {Math.ceil(data.total / 20)}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={page === 1}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    Previous payments
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={page * 20 >= data.total}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Next payments
                  </button>
                </div>
              )}
            </>
          )
        )}
      </div>
      <footer className="dialog-footer">
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || !data}
          onClick={() => setStatement(true)}
        >
          Statement & aging
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh payments
        </button>
      </footer>
      {statement &&
        createPortal(
          <SupplierStatementDialog
            api={api}
            supplierId={supplierId}
            onClose={() => setStatement(false)}
          />,
          document.body,
        )}
      {action &&
        data &&
        createPortal(
          <PaymentDialog
            api={api}
            data={data}
            reversing={action.reversing}
            onClose={() => setAction(null)}
            onSaved={() => {
              setAction(null);
              setNotice('Payment record and invoice balances updated together.');
              setPage(1);
              setInvoicePage(1);
              setRevision((n) => n + 1);
              onChanged?.();
            }}
          />,
          document.body,
        )}
    </Dialog>
  );
}
