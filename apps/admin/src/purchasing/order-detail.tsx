import { useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { money } from './money';
import type { PurchaseOrder } from './types';
export function OrderDetail({
  api,
  order,
  canManage,
  onClose,
  onEdit,
  onSaved,
}: {
  api: StaffApi;
  order: PurchaseOrder;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSaved: (o: PurchaseOrder) => void;
}) {
  const [action, setAction] = useState<'issue' | 'cancel' | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  return (
    <Dialog
      title={order.number}
      subtitle={order.supplierName + ' · ' + order.locationName}
      wide
      onClose={() => {
        if (!busy && (!reason || window.confirm('Discard this unsaved cancellation reason?')))
          onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!action || !canManage || stale) return;
          setBusy(true);
          setError('');
          try {
            const body = {
                expectedVersion: order.version,
                ...(action === 'cancel' ? { reason } : {}),
              },
              serialized = JSON.stringify({ action, body });
            if (retry.current?.body !== serialized)
              retry.current = { body: serialized, key: crypto.randomUUID() };
            onSaved(await api.purchaseOrderAction(order.id, action, body, retry.current.key));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to update order.');
            setStale(err instanceof ApiError && err.code === 'STALE_PURCHASING_RECORD');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-body field-stack">
          <div className="purchase-detail-meta">
            <span className={'badge purchase-status-' + order.status}>{order.status}</span>
            <span>Version {order.version}</span>
            <span>{new Date(order.createdAt).toLocaleDateString()}</span>
          </div>
          {order.expectedOn && <p className="small">Expected delivery: {order.expectedOn}</p>}
          {order.reference && <p className="small">Reference: {order.reference}</p>}
          <div className="table-scroll">
            <table className="inventory-table">
              <caption className="sr-only">Purchase order lines</caption>
              <thead>
                <tr>
                  <th>Product / SKU</th>
                  <th>Quantity</th>
                  <th>Unit cost</th>
                  <th>Line total</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.variantId}>
                    <td>
                      <strong>{l.productName}</strong>
                      <small>
                        {l.sku} · {Object.values(l.attributes).join(' / ')}
                      </small>
                    </td>
                    <td>{l.quantity} pcs</td>
                    <td>{money(l.unitCost)}</td>
                    <td>{money(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="purchase-total">
            <span>
              Goods subtotal (BDT)<small>Before tax, delivery and other charges</small>
            </span>
            <strong>{money(order.total)}</strong>
          </div>
          {order.notes && (
            <div className="purchase-note">
              <h3>Internal notes</h3>
              <p>{order.notes}</p>
            </div>
          )}
          {order.status !== 'draft' && (
            <details className="purchase-snapshot">
              <summary>Supplier details at issue</summary>
              {Object.entries(order.supplierSnapshot)
                .filter(([key, value]) => key !== 'id' && value)
                .map(([key, value]) => (
                  <p key={key}>
                    <strong>
                      {(
                        {
                          name: 'Name',
                          code: 'Code',
                          contactName: 'Contact',
                          phone: 'Phone',
                          email: 'Email',
                          address: 'Address',
                          taxReference: 'Tax reference',
                        } as Record<string, string>
                      )[key] ?? key}
                      :
                    </strong>{' '}
                    {String(value)}
                  </p>
                ))}
              {!Object.keys(order.supplierSnapshot).length && (
                <p>This order was cancelled before issue.</p>
              )}
            </details>
          )}
          {order.status === 'cancelled' && (
            <p className="inventory-guidance">Cancelled: {order.cancellationReason}</p>
          )}
          {action && (
            <section className="purchase-action-review">
              <h3>
                {action === 'issue' ? 'Review & issue purchase order' : 'Cancel purchase order'}
              </h3>
              <p>
                {action === 'issue'
                  ? 'Issuing freezes these supplier details, SKUs, quantities and costs. It does not send the order, receive stock or create a payable.'
                  : 'Cancellation keeps the original order and its history. No stock or payable has been created by this order.'}
              </p>
              {action === 'cancel' && (
                <label>
                  Cancellation reason
                  <textarea
                    required
                    maxLength={500}
                    rows={3}
                    value={reason}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
            </section>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
              {stale ? ' Close and reopen the order before continuing.' : ''}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => (action ? (setAction(null), setReason('')) : onClose())}
          >
            {action ? 'Back' : 'Close'}
          </button>
          {canManage && !action && order.status === 'draft' && (
            <button type="button" className="secondary-button" onClick={onEdit}>
              Edit draft
            </button>
          )}
          {canManage && !action && order.status !== 'cancelled' && (
            <button type="button" className="secondary-button" onClick={() => setAction('cancel')}>
              Cancel order
            </button>
          )}
          {canManage && !action && order.status === 'draft' && (
            <button type="button" className="primary-button" onClick={() => setAction('issue')}>
              Review & issue
            </button>
          )}
          {action && (
            <button className="primary-button" disabled={busy || stale}>
              {busy ? 'Saving…' : action === 'issue' ? 'Confirm & issue' : 'Confirm cancellation'}
            </button>
          )}
        </footer>
      </form>
    </Dialog>
  );
}
