import { useState } from 'react';
import { StaffApi } from '../api';
import { ReservationPanel } from './reservation-panel';
import { Dialog } from '../components/dialog';
import type { SalesOrder } from './types';
import { money } from './helpers';
export function SalesDetail({
  order: o,
  close,
  edit,
  cancel,
  canManage,
  api,
  refresh,
}: {
  order: SalesOrder;
  close: () => void;
  edit: () => void;
  cancel: () => void;
  canManage: boolean;
  api: StaffApi;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  function action(next: () => void) {
    if (!busy && (!dirty || window.confirm('Discard unsaved stock hold details?'))) next();
  }
  return (
    <Dialog
      title={o.number}
      subtitle={
        o.status === 'draft'
          ? 'Sales draft · Version ' + o.version
          : 'Cancelled sales draft · Version ' + o.version
      }
      onClose={() => action(close)}
      wide
    >
      <div className="sales-dialog-body">
        <p className="sales-scope">
          {o.stockReserved
            ? 'Stock is reserved for this draft. No sale, invoice or payment has been posted.'
            : 'No stock is currently held for this draft. No customer balance has been created.'}
        </p>
        <div className="sales-facts">
          <div>
            <span>Customer</span>
            <strong>{o.customerName}</strong>
            <small>{o.customerSnapshot.code}</small>
          </div>
          <div>
            <span>Channel & location</span>
            <strong>
              {o.channel === 'retail' ? 'Retail' : 'Archived wholesale'} · {o.locationName}
            </strong>
          </div>
          <div>
            <span>Requested fulfillment</span>
            <strong>{o.fulfillOn ?? 'Not specified'}</strong>
          </div>
          <div>
            <span>Customer reference</span>
            <strong>{o.reference || 'Not provided'}</strong>
          </div>
          <div>
            <span>Phone / email snapshot</span>
            <strong>
              {o.customerSnapshot.phone || 'No phone'}
              <br />
              {o.customerSnapshot.email || 'No email'}
            </strong>
          </div>
          <div>
            <span>Last saved</span>
            <strong>
              {new Date(o.updatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} (Dhaka)
            </strong>
          </div>
        </div>
        <div className="sales-grid">
          {(['billingAddress', 'deliveryAddress'] as const).map((k) => (
            <section key={k}>
              <h3>
                {k === 'billingAddress' ? 'Billing address snapshot' : 'Delivery address snapshot'}
              </h3>
              <p>
                {o.customerSnapshot[k]
                  ? ['line1', 'line2', 'area', 'district', 'postalCode']
                      .map((f) => o.customerSnapshot[k]![f])
                      .filter(Boolean)
                      .join(', ')
                  : 'Not provided'}
                {o.customerSnapshot[k] && (
                  <>
                    <br />
                    Bangladesh
                  </>
                )}
              </p>
            </section>
          ))}
        </div>
        <div className="sales-table-wrap" tabIndex={0} role="region" aria-label="Sales draft lines">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.variantId}>
                  <td>
                    <strong>{l.productName}</strong>
                    <small>
                      {l.sku} · {Object.values(l.attributes).join(' / ')}
                    </small>
                  </td>
                  <td>{BigInt(l.quantity).toLocaleString('en-BD')}</td>
                  <td>
                    {money(l.unitPrice)}
                    <small>
                      {l.priceMode === 'catalog' ? 'Catalog price' : 'Override'} · catalog{' '}
                      {money(l.catalogPrice)}
                    </small>
                  </td>
                  <td>{money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sales-total">
          <span>Draft goods total</span>
          <strong>{money(o.total)}</strong>
        </div>
        {o.priceReason && (
          <section>
            <h3>Archived price override reason</h3>
            <p className="sales-prewrap">{o.priceReason}</p>
          </section>
        )}
        {o.notes && (
          <section>
            <h3>Internal order notes</h3>
            <p className="sales-prewrap">{o.notes}</p>
          </section>
        )}
        {o.status === 'cancelled' && (
          <section className="sales-warning">
            <h3>Cancellation record</h3>
            <p>{o.cancellationReason}</p>
            <p>
              {new Date(o.cancelledAt!).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} (Dhaka)
            </p>
          </section>
        )}
        <p className="sales-hint">
          Contact and product details are captured when this draft is saved. Later directory edits
          do not silently rewrite the saved draft. Editing and saving refreshes its snapshot.
        </p>
        <ReservationPanel
          api={api}
          order={o}
          onChanged={refresh}
          onBusy={setBusy}
          onDirty={setDirty}
        />
      </div>
      <footer className="dialog-footer sales-actions">
        <button className="secondary-button" onClick={() => action(close)} disabled={busy}>
          Close
        </button>
        {canManage && o.status === 'draft' && !o.stockReserved && !dirty && (
          <>
            <button className="secondary-button" onClick={() => action(cancel)} disabled={busy}>
              Cancel draft
            </button>
            <button
              className="primary-button"
              disabled={
                busy || o.channel !== 'retail' || o.lines.some((l) => l.priceMode !== 'catalog')
              }
              onClick={() => action(edit)}
            >
              Edit draft
            </button>
          </>
        )}
      </footer>
    </Dialog>
  );
}
