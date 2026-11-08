import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { InvoiceDialog } from './invoice-dialog';
import { money } from './money';
import type { InvoicePage, SupplierInvoice } from './invoice-types';
export function InvoicePanel({
  api,
  orderId,
  onChanged,
}: {
  api: StaffApi;
  orderId: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<InvoicePage | null>(null),
    [page, setPage] = useState(1),
    [linePage, setLinePage] = useState(1),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [action, setAction] = useState<{ reversing?: SupplierInvoice } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .orderInvoices(orderId, page, linePage)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setError(e instanceof Error ? e.message : 'Unable to load invoices.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, orderId, page, linePage, revision]);
  return (
    <section className="purchase-receiving invoice-panel" aria-label="Supplier invoices for order">
      <div className="receipt-heading">
        <div>
          <h3>Supplier invoices</h3>
          <p>Match the supplier’s document to received goods.</p>
        </div>
        {data && !loading && <strong>{money(data.unsettled)} recorded unsettled</strong>}
      </div>
      <p className="inventory-guidance">
        Payments, credit notes, opening balances and accounting journals are not included yet. This
        total covers active invoices recorded here.
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
        <p role="status">Loading invoices…</p>
      ) : (
        data && (
          <>
            {data.canPost && data.lines.length > 0 && (
              <button type="button" className="primary-button" onClick={() => setAction({})}>
                Record invoice
              </button>
            )}
            {!data.linesTotal && (
              <p>
                No uninvoiced received quantities. Receive goods first, or review existing invoices.
              </p>
            )}
            {data.linesTotal > 25 && (
              <div className="inventory-pagination">
                <span>
                  Received lines · Page {linePage} of {Math.ceil(data.linesTotal / 25)}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={linePage === 1}
                  onClick={() => setLinePage((n) => n - 1)}
                >
                  Previous received lines
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={linePage * 25 >= data.linesTotal}
                  onClick={() => setLinePage((n) => n + 1)}
                >
                  Next received lines
                </button>
              </div>
            )}
            <h4>Invoice history</h4>
            {!data.items.length ? (
              <p>No supplier invoice recorded for this order.</p>
            ) : (
              data.items.map((i) => (
                <article className="receipt-history-card" key={i.id}>
                  <div className="receipt-heading">
                    <h4>{i.number}</h4>
                    <strong>{money(i.total)}</strong>
                  </div>
                  <p>
                    {i.reversedAt ? 'Reversed' : 'Recorded · Unsettled'} · Invoice {i.invoiceOn} ·
                    Due {i.dueOn}
                  </p>
                  <p>
                    {i.actorName} · {i.reason}
                  </p>
                  <details>
                    <summary>Invoice lines & charges</summary>
                    <ul>
                      {i.lines.map((l, k) => (
                        <li key={k}>
                          {l.productName} · {l.sku} · {l.quantity} pcs × {money(l.unitCost)} ={' '}
                          {money(l.lineTotal)} · Receipt {l.receiptId.slice(0, 8)}
                        </li>
                      ))}
                    </ul>
                    <p>
                      Goods {money(i.goods)} · Tax {money(i.tax)} · Delivery {money(i.delivery)} ·
                      Discount {money(i.discount)}
                    </p>
                  </details>
                  {i.reversedAt ? (
                    <p>
                      Reversed {new Date(i.reversedAt).toLocaleString()} · {i.reversalReason}
                    </p>
                  ) : (
                    data.canReverse && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setAction({ reversing: i })}
                      >
                        Reverse invoice {i.number}
                      </button>
                    )
                  )}
                </article>
              ))
            )}
            {data.total > 20 && (
              <div className="inventory-pagination">
                <span>
                  Invoice page {page} of {Math.ceil(data.total / 20)}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={page === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous invoices
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={page * 20 >= data.total}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next invoices
                </button>
              </div>
            )}
          </>
        )
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={loading}
        onClick={() => setRevision((n) => n + 1)}
      >
        Refresh invoices
      </button>
      {action &&
        data &&
        createPortal(
          <InvoiceDialog
            api={api}
            data={data}
            reversing={action.reversing}
            onClose={() => setAction(null)}
            onSaved={() => {
              setAction(null);
              setNotice('Supplier invoice updated. Stock is unchanged.');
              setPage(1);
              setLinePage(1);
              setRevision((n) => n + 1);
              onChanged?.();
            }}
          />,
          document.body,
        )}
    </section>
  );
}
