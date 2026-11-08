import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { PurchaseReceipt, ReceivingPage } from './receipt-types';
export function ReceiptDialog({
  api,
  data,
  reversing,
  onClose,
  onSaved,
}: {
  api: StaffApi;
  data: ReceivingPage;
  reversing?: PurchaseReceipt | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(''),
    [reference, setReference] = useState(''),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = !!(reason || reference || Object.values(quantities).some(Boolean));
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const close = () => {
    if (!busy && (!dirty || window.confirm('Discard this unsaved receipt action?'))) onClose();
  };
  const selected = data.lines.filter((l) => !!quantities[l.id]);
  const valid =
    selected.length > 0 &&
    selected.every(
      (l) =>
        /^[1-9]\d{0,8}$/.test(quantities[l.id]!) &&
        BigInt(quantities[l.id]!) <= BigInt(l.remaining),
    );
  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = {
          expectedRevision: data.receiptRevision,
          reason: reason.trim(),
          reference: reference.trim(),
          ...(!reversing
            ? { lines: selected.map((l) => ({ orderLineId: l.id, quantity: quantities[l.id]! })) }
            : {}),
        },
        serialized = JSON.stringify(body);
      if (retry.current?.body !== serialized)
        retry.current = { body: serialized, key: crypto.randomUUID() };
      if (reversing) await api.reversePurchaseReceipt(reversing.id, body, retry.current.key);
      else
        await api.receivePurchaseOrder(
          data.orderId,
          body as Parameters<StaffApi['receivePurchaseOrder']>[1],
          retry.current.key,
        );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save receipt.');
      setStale(
        err instanceof ApiError &&
          ['STALE_RECEIPT', 'PURCHASE_ORDER_STATE', 'RECEIPT_ALREADY_REVERSED'].includes(
            err.code ?? '',
          ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={reversing ? 'Reverse purchase receipt' : 'Receive purchase order'}
      subtitle={data.orderNumber + ' · ' + data.locationName}
      onClose={close}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setError('');
          if (!reversing && !valid) {
            setError(
              'Enter a positive whole-piece quantity for at least one SKU, within its remaining ordered quantity.',
            );
            return;
          }
          if (review) void save();
          else setReview(true);
        }}
      >
        <div className="dialog-body field-stack">
          <div className="inventory-guidance">
            {reversing
              ? 'This reverses every line of this receipt. Stock is removed from the delivery location and the ordered quantity becomes receivable again. The original receipt stays in history.'
              : 'Enter only quantities physically received now. Leave a quantity blank to skip that SKU. This saves the receipt and stock together; supplier bills and payments remain separate.'}
          </div>
          {review ? (
            <section className="inventory-review">
              <h3>Review before {reversing ? 'reversal' : 'receiving'}</h3>
              <dl>
                <div>
                  <dt>Order</dt>
                  <dd>{data.orderNumber}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{data.locationName}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{reason}</dd>
                </div>
                {reference && (
                  <div>
                    <dt>Reference</dt>
                    <dd>{reference}</dd>
                  </div>
                )}
              </dl>
              <ul>
                {(reversing
                  ? reversing.lines
                  : selected.map((l) => ({
                      orderLineId: l.id,
                      sku: l.sku,
                      productName: l.productName,
                      quantity: quantities[l.id]!,
                    }))
                ).map((l) => (
                  <li key={l.orderLineId}>
                    <span>
                      {l.productName}
                      <small>{l.sku}</small>
                    </span>
                    <strong>
                      {reversing ? '−' : '+'}
                      {l.quantity} pcs
                    </strong>
                  </li>
                ))}
              </ul>
              <p className="small muted">
                {reversing
                  ? 'Current stock must cover every reversed line.'
                  : 'Remaining ordered quantities and permissions are checked again when you confirm.'}
              </p>
            </section>
          ) : (
            <>
              {reversing ? (
                <div className="purchase-reversal-lines">
                  {reversing.lines.map((l) => (
                    <div key={l.orderLineId}>
                      <span>
                        {l.productName}
                        <small>{l.sku}</small>
                      </span>
                      <strong>−{l.quantity} pcs</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="purchase-receipt-lines">
                  {data.lines.map((l) => (
                    <div key={l.id} className="purchase-receipt-line">
                      <div>
                        <strong>{l.productName}</strong>
                        <small>{l.sku}</small>
                        <span className="small muted">
                          Ordered {l.ordered} · Received {l.received} · Remaining {l.remaining}
                        </span>
                      </div>
                      <label>
                        Receiving now (pcs)
                        <input
                          aria-label={'Receive quantity for ' + l.sku}
                          inputMode="numeric"
                          maxLength={9}
                          pattern="[1-9][0-9]{0,8}"
                          placeholder={l.remaining === '0' ? 'Complete' : 'Leave blank to skip'}
                          value={quantities[l.id] ?? ''}
                          disabled={l.remaining === '0' || busy}
                          onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}
              <label>
                {reversing ? 'Reversal reason' : 'Receipt reason'}
                <textarea
                  required
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  placeholder={
                    reversing
                      ? 'Why is the full receipt being corrected?'
                      : 'What goods were received and checked?'
                  }
                />
              </label>
              <label>
                Delivery note / reference (optional)
                <input
                  maxLength={100}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  disabled={busy}
                />
              </label>
              {!reversing && (
                <p className="small muted">
                  A non-empty reference cannot repeat on another active receipt for this order.
                  Reverse a mistaken receipt before reusing its reference.
                </p>
              )}
            </>
          )}
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">
              {error}
              {stale ? ' Close this form and refresh receiving before continuing.' : ''}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => (review ? setReview(false) : close())}
          >
            {review ? 'Back to edit' : 'Cancel'}
          </button>
          <button className="primary-button" disabled={busy || stale}>
            {busy
              ? 'Saving…'
              : review
                ? reversing
                  ? 'Confirm reversal'
                  : 'Confirm receipt'
                : 'Review ' + (reversing ? 'reversal' : 'receipt')}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
