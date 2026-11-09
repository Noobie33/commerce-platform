import { useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { SalesOrder } from './types';
import { problem } from './helpers';
export function CancelDraft({
  api,
  order,
  close,
  saved,
}: {
  api: StaffApi;
  order: SalesOrder;
  close: () => void;
  saved: (r: { id: string }) => void;
}) {
  const [reason, setReason] = useState(''),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false);
  const key = useRef(crypto.randomUUID()),
    errorRef = useRef<HTMLParagraphElement>(null),
    reviewRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (review) {
      const heading = reviewRef.current,
        dialog = heading?.closest('dialog');
      if (heading && dialog) {
        heading.focus({ preventScroll: true });
        dialog.scrollTop +=
          heading.getBoundingClientRect().top -
          dialog.getBoundingClientRect().top -
          dialog.clientHeight / 2;
      }
    }
  }, [review]);
  function dismiss() {
    if (!busy && (!reason || window.confirm('Discard this cancellation reason?'))) close();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || stale) return;
    if (!reason.trim()) {
      setError('A cancellation reason is required');
      return;
    }
    if (!review) {
      setReview(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      saved(
        await api.cancelSalesOrder(
          order.id,
          { expectedVersion: order.version, reason },
          key.current,
        ),
      );
    } catch (e) {
      setError(problem(e));
      if (
        e instanceof Error &&
        'code' in e &&
        ['SALES_STALE', 'SALES_STATE', 'SALES_RESERVED'].includes(String(e.code))
      )
        setStale(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Cancel sales draft"
      subtitle={order.number + ' · ' + order.customerName}
      onClose={dismiss}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="sales-dialog-body">
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">
              {error}
            </p>
          )}
          <p>
            Cancellation retains the order and its lines. No stock or customer balance will change.
          </p>
          <label className="sales-fields">
            Cancellation reason *
            <textarea
              required
              maxLength={500}
              rows={3}
              disabled={busy || review || stale}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                key.current = crypto.randomUUID();
              }}
            />
          </label>
          {review && (
            <p className="sales-warning" ref={reviewRef} tabIndex={-1}>
              Confirm cancellation of {order.number}? Reason: {reason}
            </p>
          )}
        </div>
        <footer className="dialog-footer sales-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={dismiss}>
            Close
          </button>
          {review && !stale && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Back
            </button>
          )}
          <button className="primary-button" disabled={busy || stale}>
            {busy ? 'Cancelling…' : review ? 'Confirm cancellation' : 'Review cancellation'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
