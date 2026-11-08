import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { money } from './money';
import type { InvoicePage, SupplierInvoice } from './invoice-types';
const keyOf = (l: { receiptId: string; orderLineId: string }) => l.receiptId + ':' + l.orderLineId;
function amount(value: string): bigint | null {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return n <= 999999999999n ? n : null;
}
function decimal(n: bigint) {
  return n / 100n + '.' + (n % 100n).toString().padStart(2, '0');
}
export function InvoiceDialog({
  api,
  data,
  reversing,
  onClose,
  onSaved,
}: {
  api: StaffApi;
  data: InvoicePage;
  reversing?: SupplierInvoice | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [number, setNumber] = useState(''),
    [invoiceOn, setInvoiceOn] = useState(''),
    [dueOn, setDueOn] = useState(''),
    [tax, setTax] = useState('0.00'),
    [delivery, setDelivery] = useState('0.00'),
    [discount, setDiscount] = useState('0.00'),
    [reason, setReason] = useState(''),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [costs, setCosts] = useState<Record<string, string>>({}),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = !!(
    number ||
    invoiceOn ||
    dueOn ||
    reason ||
    Object.values(quantities).some(Boolean) ||
    Object.keys(costs).length ||
    tax !== '0.00' ||
    delivery !== '0.00' ||
    discount !== '0.00'
  );
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
    if (!busy && (!dirty || window.confirm('Discard this unsaved invoice action?'))) onClose();
  };
  const selected = data.lines.filter((l) => !!quantities[keyOf(l)]);
  const goods = selected.reduce((n, l) => {
    const q = quantities[keyOf(l)]!,
      c = amount(costs[keyOf(l)] ?? l.unitCost);
    return n + (/^[1-9]\d{0,8}$/.test(q) && c !== null ? BigInt(q) * c : 0n);
  }, 0n);
  const t = amount(tax),
    d = amount(delivery),
    disc = amount(discount),
    total = goods + (t ?? 0n) + (d ?? 0n) - (disc ?? 0n);
  const valid =
    selected.length > 0 &&
    selected.every(
      (l) =>
        /^[1-9]\d{0,8}$/.test(quantities[keyOf(l)]!) &&
        BigInt(quantities[keyOf(l)]!) <= BigInt(l.remaining) &&
        amount(costs[keyOf(l)] ?? l.unitCost) !== null,
    ) &&
    t !== null &&
    d !== null &&
    disc !== null &&
    disc <= goods &&
    total > 0n &&
    total <= 99999999999999n &&
    goods <= 99999999999999n;
  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = reversing
        ? { expectedRevision: data.invoiceRevision, reason: reason.trim() }
        : {
            expectedRevision: data.invoiceRevision,
            number: number.trim(),
            invoiceOn,
            dueOn,
            tax,
            delivery,
            discount,
            reason: reason.trim(),
            lines: selected.map((l) => ({
              receiptId: l.receiptId,
              orderLineId: l.orderLineId,
              quantity: quantities[keyOf(l)]!,
              unitCost: costs[keyOf(l)] ?? l.unitCost,
            })),
          };
      const serialized = JSON.stringify(body);
      if (retry.current?.body !== serialized)
        retry.current = { body: serialized, key: crypto.randomUUID() };
      if (reversing)
        await api.reverseSupplierInvoice(
          reversing.id,
          body as { expectedRevision: number; reason: string },
          retry.current.key,
        );
      else
        await api.postSupplierInvoice(
          data.orderId,
          body as Parameters<StaffApi['postSupplierInvoice']>[1],
          retry.current.key,
        );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save invoice');
      if (
        e instanceof ApiError &&
        [
          'INVOICE_STALE',
          'INVOICE_REVERSED',
          'INVOICE_ORDER_STATE',
          'INVOICE_RECEIPT_UNAVAILABLE',
          'INVOICE_OVER_QUANTITY',
        ].includes(e.code ?? '')
      )
        setStale(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={reversing ? 'Reverse supplier invoice' : 'Record supplier invoice'}
      subtitle={data.orderNumber + ' · ' + data.supplierName}
      onClose={close}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (busy || stale) return;
          if (review) {
            void save();
            return;
          }
          if (!reason.trim()) {
            setError('Enter a reason for this invoice action.');
            return;
          }
          if (
            !reversing &&
            (!valid || !number.trim() || !invoiceOn || !dueOn || dueOn < invoiceOn)
          ) {
            setError('Check invoice dates, number, quantities, costs and charges.');
            return;
          }
          setError('');
          setReview(true);
        }}
      >
        <div className="dialog-body">
          <p className="inventory-guidance">
            {reversing
              ? 'Reversal removes this invoice from unsettled recorded invoices and releases its received quantities for correction. Stock stays unchanged. The original invoice remains in history.'
              : 'Record the supplier document against received goods. Unit costs start from the purchase order; check them against the actual invoice. Enter tax and delivery amounts from that document. This does not pay the supplier or change stock.'}
          </p>
          {reversing ? (
            <div>
              <h3>{reversing.number}</h3>
              <p>
                {money(reversing.total)} · Due {reversing.dueOn}
              </p>
              <ul>
                {reversing.lines.map((l, i) => (
                  <li key={i}>
                    {l.sku} · {l.quantity} pcs · {money(l.lineTotal)}
                  </li>
                ))}
              </ul>
            </div>
          ) : review ? (
            <>
              <h3>Review supplier invoice</h3>
              <dl className="invoice-review">
                <dt>Supplier invoice</dt>
                <dd>{number}</dd>
                <dt>Invoice / due</dt>
                <dd>
                  {invoiceOn} / {dueOn}
                </dd>
              </dl>
              <ul>
                {selected.map((l) => (
                  <li key={keyOf(l)}>
                    {l.sku} · {quantities[keyOf(l)]} pcs × {money(costs[keyOf(l)] ?? l.unitCost)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="purchase-form-grid">
                <label>
                  Supplier invoice number
                  <input
                    value={number}
                    maxLength={100}
                    required
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </label>
                <label>
                  Invoice date
                  <input
                    type="date"
                    value={invoiceOn}
                    min="2000-01-01"
                    max="2199-12-31"
                    required
                    onChange={(e) => setInvoiceOn(e.target.value)}
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={dueOn}
                    min={invoiceOn || '2000-01-01'}
                    max="2199-12-31"
                    required
                    onChange={(e) => setDueOn(e.target.value)}
                  />
                </label>
              </div>
              {data.lines.map((l) => (
                <div className="receipt-entry-line" key={keyOf(l)}>
                  <strong>{l.productName}</strong>
                  <small>
                    {l.sku} · Delivery {l.reference || l.receiptId.slice(0, 8)} ·{' '}
                    {new Date(l.receivedAt).toLocaleDateString()}
                  </small>
                  <p>
                    Received {l.received} · Invoiced {l.invoiced} · Remaining {l.remaining}
                  </p>
                  <div className="purchase-form-grid">
                    <label>
                      Invoice quantity (pcs)
                      <input
                        aria-label={
                          'Invoice quantity for ' + l.sku + ' receipt ' + l.receiptId.slice(0, 8)
                        }
                        inputMode="numeric"
                        value={quantities[keyOf(l)] ?? ''}
                        placeholder="Leave blank to skip"
                        onChange={(e) =>
                          setQuantities((q) => ({ ...q, [keyOf(l)]: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Invoice unit cost (BDT)
                      <input
                        aria-label={
                          'Invoice cost for ' + l.sku + ' receipt ' + l.receiptId.slice(0, 8)
                        }
                        inputMode="decimal"
                        value={costs[keyOf(l)] ?? l.unitCost}
                        onChange={(e) => setCosts((c) => ({ ...c, [keyOf(l)]: e.target.value }))}
                      />
                    </label>
                  </div>
                </div>
              ))}
              <div className="purchase-form-grid">
                <label>
                  Tax amount (BDT)
                  <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
                </label>
                <label>
                  Delivery charge (BDT)
                  <input
                    inputMode="decimal"
                    value={delivery}
                    onChange={(e) => setDelivery(e.target.value)}
                  />
                </label>
                <label>
                  Goods discount (BDT)
                  <input
                    inputMode="decimal"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          {!reversing && (
            <div className="invoice-totals">
              <span>Goods {money(decimal(goods))}</span>
              <span>Tax {t !== null ? money(decimal(t)) : 'Check amount'}</span>
              <span>Delivery {d !== null ? money(decimal(d)) : 'Check amount'}</span>
              <span>Discount {disc !== null ? money(decimal(disc)) : 'Check amount'}</span>
              <strong>
                Invoice total {valid ? money(decimal(total)) : 'Check invoice amounts'}
              </strong>
            </div>
          )}
          {review ? (
            <p>Reason: {reason}</p>
          ) : (
            <label>
              {reversing ? 'Invoice reversal reason' : 'Invoice reason'}
              <textarea
                maxLength={500}
                value={reason}
                required
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
              {error}
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
                  ? 'Confirm invoice reversal'
                  : 'Confirm invoice'
                : reversing
                  ? 'Review invoice reversal'
                  : 'Review invoice'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
