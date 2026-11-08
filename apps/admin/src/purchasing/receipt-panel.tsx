import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { ReceiptDialog } from './receipt-dialog';
import type { PurchaseReceipt, ReceivingPage } from './receipt-types';
export function ReceiptPanel({
  api,
  orderId,
  onActive,
}: {
  api: StaffApi;
  orderId: string;
  onActive: (value: boolean | null) => void;
}) {
  const [data, setData] = useState<ReceivingPage | null>(null),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [action, setAction] = useState<{ reversing?: PurchaseReceipt } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    onActive(null);
    void api
      .purchaseReceiving(orderId, page)
      .then((value) => {
        if (active) {
          setData(value);
          onActive(value.hasActiveReceipts);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load receipts.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, orderId, page, revision, onActive]);
  const complete = !!data?.lines.length && data.lines.every((l) => l.remaining === '0'),
    partial = data?.hasActiveReceipts;
  return (
    <section className="purchase-receiving" aria-label="Purchase order receiving">
      <div className="purchase-receiving-heading">
        <div>
          <h3>Goods receiving</h3>
          <p>Physical quantities at the order’s delivery location.</p>
        </div>
        {data && !loading && (
          <span
            className={
              'badge ' +
              (complete
                ? 'purchase-status-issued'
                : partial
                  ? 'purchase-status-draft'
                  : 'purchase-status-cancelled')
            }
          >
            {data.orderStatus === 'cancelled'
              ? 'Cancelled'
              : complete
                ? 'Fully received'
                : partial
                  ? 'Partially received'
                  : 'Awaiting receipt'}
          </span>
        )}
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error ? (
        <div className="form-error" role="alert">
          {error}
          <button type="button" className="text-button" onClick={() => setRevision((n) => n + 1)}>
            Retry receiving
          </button>
        </div>
      ) : loading ? (
        <p className="small muted" role="status">
          Loading receiving…
        </p>
      ) : (
        data && (
          <>
            <div className="table-scroll">
              <table className="inventory-table receipt-progress-table">
                <caption className="sr-only">Ordered, received and remaining quantities</caption>
                <thead>
                  <tr>
                    <th>Product / SKU</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.productName}</strong>
                        <small>{l.sku}</small>
                      </td>
                      <td>{l.ordered}</td>
                      <td>{l.received}</td>
                      <td>
                        <strong>{l.remaining}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="purchase-receiving-actions">
              {data.canReceive && !complete && (
                <button type="button" className="primary-button" onClick={() => setAction({})}>
                  Receive goods
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRevision((n) => n + 1)}
              >
                Refresh receiving
              </button>
            </div>
            {data.hasActiveReceipts && (
              <p className="small muted">
                Reverse active receipts before cancelling this order. Reversal requires sufficient
                stock at this location.
              </p>
            )}
            <h4>Receipt history</h4>
            {!data.items.length ? (
              <p className="small muted">No goods have been received against this order.</p>
            ) : (
              <div className="purchase-receipt-history">
                {data.items.map((r) => (
                  <article key={r.id}>
                    <header>
                      <span
                        className={
                          'badge ' +
                          (r.reversedAt ? 'purchase-status-cancelled' : 'purchase-status-issued')
                        }
                      >
                        {r.reversedAt ? 'Reversed' : 'Received'}
                      </span>
                      <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
                    </header>
                    <h4>{r.reason}</h4>
                    <p className="small muted">
                      {r.actorName}
                      {r.reference ? ' · ' + r.reference : ''}
                    </p>
                    <ul>
                      {r.lines.map((l) => (
                        <li key={l.orderLineId}>
                          <span>{l.sku}</span>
                          <strong>{l.quantity} pcs</strong>
                        </li>
                      ))}
                    </ul>
                    <footer>
                      <span className="small muted">
                        Stock ref. {r.inventoryPostingId.slice(0, 8)}
                      </span>
                      {r.canReverse && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setAction({ reversing: r })}
                        >
                          Reverse receipt
                        </button>
                      )}
                    </footer>
                    {r.reversedAt && (
                      <p className="small muted">
                        Reversed {new Date(r.reversedAt).toLocaleString()} · {r.reversalReason}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
            {data.total > data.pageSize && (
              <div className="inventory-pagination">
                <span>
                  Page {page} of {Math.ceil(data.total / data.pageSize)}
                </span>
                <div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={page === 1}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    Previous receipts
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={page * data.pageSize >= data.total}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Next receipts
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
      {action &&
        data &&
        createPortal(
          <ReceiptDialog
            api={api}
            data={data}
            reversing={action.reversing}
            onClose={() => setAction(null)}
            onSaved={() => {
              setAction(null);
              setNotice('Receipt and stock updated together.');
              onActive(null);
              setPage(1);
              setRevision((n) => n + 1);
            }}
          />,
          document.body,
        )}
    </section>
  );
}
