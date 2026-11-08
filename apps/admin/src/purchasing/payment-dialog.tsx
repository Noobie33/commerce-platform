import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { money } from './money';
import type { SupplierPayment, SupplierPaymentPage } from './payment-types';
function minor(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return null;
  const [a, b = ''] = value.split('.');
  const n = BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'));
  return n <= 99999999999999n ? n : null;
}
function decimal(n: bigint) {
  return n / 100n + '.' + (n % 100n).toString().padStart(2, '0');
}
export function PaymentDialog({
  api,
  data,
  reversing,
  onClose,
  onSaved,
}: {
  api: StaffApi;
  data: SupplierPaymentPage;
  reversing?: SupplierPayment | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paidOn, setPaidOn] = useState(data.today),
    [method, setMethod] = useState<'cash' | 'bank' | 'mobile'>('bank'),
    [source, setSource] = useState(''),
    [reference, setReference] = useState(''),
    [amount, setAmount] = useState(''),
    [allocations, setAllocations] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(''),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [error, setError] = useState('');
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = !!(
    paidOn !== data.today ||
    method !== 'bank' ||
    source ||
    reference ||
    amount ||
    reason ||
    Object.values(allocations).some(Boolean)
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
    if (!busy && (!dirty || window.confirm('Discard this unsaved payment record?'))) onClose();
  };
  const selected = data.invoices.filter((i) => !!allocations[i.id]),
    sum = selected.reduce((n, i) => n + (minor(allocations[i.id]!) ?? 0n), 0n),
    recorded = minor(amount),
    earliest = selected.reduce((d, i) => (i.invoiceOn > d ? i.invoiceOn : d), '2000-01-01');
  const valid =
    recorded !== null &&
    recorded > 0n &&
    selected.length > 0 &&
    sum === recorded &&
    selected.every((i) => {
      const n = minor(allocations[i.id]!);
      return n !== null && n > 0n && n <= minor(i.remaining)!;
    }) &&
    !!source.trim() &&
    !!reference.trim() &&
    paidOn >= earliest &&
    paidOn <= data.today;
  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = reversing
        ? { expectedRevision: data.paymentRevision, reason: reason.trim() }
        : {
            expectedRevision: data.paymentRevision,
            paidOn,
            method,
            source: source.trim(),
            reference: reference.trim(),
            amount,
            reason: reason.trim(),
            allocations: selected.map((i) => ({ invoiceId: i.id, amount: allocations[i.id]! })),
          };
      const text = JSON.stringify(body);
      if (retry.current?.body !== text) retry.current = { body: text, key: crypto.randomUUID() };
      if (reversing)
        await api.reverseSupplierPayment(
          reversing.id,
          body as { expectedRevision: number; reason: string },
          retry.current.key,
        );
      else
        await api.recordSupplierPayment(
          data.supplier.id,
          body as Parameters<StaffApi['recordSupplierPayment']>[1],
          retry.current.key,
        );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save the payment record.');
      if (
        e instanceof ApiError &&
        [
          'PAYMENT_STALE',
          'PAYMENT_REVERSED',
          'PAYMENT_INVOICE_UNAVAILABLE',
          'PAYMENT_EXCEEDS_DUE',
        ].includes(e.code ?? '')
      )
        setStale(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={reversing ? 'Reverse payment record' : 'Record supplier payment'}
      subtitle={data.supplier.name}
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
          if (!reason.trim() || (!reversing && !valid)) {
            setError(
              'Check the date, payment details and allocation amounts. Allocations must equal the recorded payment and stay within each invoice balance.',
            );
            return;
          }
          setError('');
          setReview(true);
        }}
      >
        <div className="dialog-body">
          <p className="inventory-guidance">
            {reversing
              ? 'This reverses the entire recorded payment and restores all the invoice balances shown below. It does not refund or move money. Keep the original transaction record and enter a reason.'
              : 'Record a payment already made. This screen does not send money. Allocate the exact amount to this supplier’s invoices; advances and unallocated payments are not included.'}
          </p>
          {reversing ? (
            <>
              <h3>{reversing.reference}</h3>
              <p>
                {money(reversing.amount)} · {reversing.paidOn} · {reversing.method} ·{' '}
                {reversing.source}
              </p>
              <ul>
                {reversing.allocations.map((a) => (
                  <li key={a.invoiceId}>
                    {a.number} · {a.orderNumber} · {money(a.amount)}
                  </li>
                ))}
              </ul>
            </>
          ) : review ? (
            <>
              <h3>Review recorded payment</h3>
              <dl className="invoice-review">
                <dt>Paid on</dt>
                <dd>{paidOn}</dd>
                <dt>Method / source</dt>
                <dd>
                  {method} / {source}
                </dd>
                <dt>Reference</dt>
                <dd>{reference}</dd>
              </dl>
              <ul>
                {selected.map((i) => (
                  <li key={i.id}>
                    {i.number} · {i.orderNumber} · {money(allocations[i.id]!)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="purchase-form-grid">
                <label>
                  Payment date
                  <input
                    type="date"
                    value={paidOn}
                    min={earliest}
                    max={data.today}
                    required
                    onChange={(e) => setPaidOn(e.target.value)}
                  />
                </label>
                <label>
                  Payment method
                  <select
                    aria-label="Payment method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as typeof method)}
                  >
                    <option value="bank">Bank</option>
                    <option value="cash">Cash</option>
                    <option value="mobile">Mobile wallet</option>
                  </select>
                </label>
                <label>
                  Paid from (label)
                  <input
                    value={source}
                    maxLength={100}
                    required
                    placeholder="Business bank or cash drawer"
                    onChange={(e) => setSource(e.target.value)}
                  />
                </label>
                <label>
                  Payment / voucher reference
                  <input
                    value={reference}
                    maxLength={100}
                    required
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <label>
                  Payment amount (BDT)
                  <input
                    inputMode="decimal"
                    value={amount}
                    required
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
              </div>
              <h3>Allocate to invoices</h3>
              <p>
                Leave an amount blank to skip an invoice. This page contains up to 25 outstanding
                invoices.
              </p>
              {data.invoices.map((i) => (
                <div className="receipt-entry-line" key={i.id}>
                  <strong>{i.number}</strong>
                  <small>
                    {i.orderNumber} · Due {i.dueOn}
                  </small>
                  <p>
                    Total {money(i.total)} · Paid {money(i.paid)} · Remaining {money(i.remaining)}
                  </p>
                  <label>
                    Allocate amount (BDT)
                    <input
                      aria-label={'Allocate to ' + i.number}
                      inputMode="decimal"
                      value={allocations[i.id] ?? ''}
                      placeholder="Leave blank to skip"
                      onChange={(e) => setAllocations((a) => ({ ...a, [i.id]: e.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setAllocations((a) => ({ ...a, [i.id]: i.remaining }))}
                  >
                    Use remaining for {i.number}
                  </button>
                </div>
              ))}
            </>
          )}
          {!reversing && (
            <div className="invoice-totals">
              <span>Allocated {money(decimal(sum))}</span>
              <strong>
                Payment {recorded !== null ? money(decimal(recorded)) : 'Enter amount'}
              </strong>
            </div>
          )}
          {review ? (
            <p>Reason: {reason}</p>
          ) : (
            <label>
              {reversing ? 'Payment reversal reason' : 'Payment reason'}
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
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
                  ? 'Confirm payment reversal'
                  : 'Confirm payment record'
                : reversing
                  ? 'Review payment reversal'
                  : 'Review payment'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
