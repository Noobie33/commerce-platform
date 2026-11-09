import { useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { Customer, CreditInput } from './types';
import { creditMoney, errorText } from './helpers';
export function CreditEditor({
  api,
  customer: c,
  close,
  saved,
}: {
  api: StaffApi;
  customer: Customer;
  close: () => void;
  saved: (r: { id: string }) => void;
}) {
  const [value, setValue] = useState<CreditInput>({
      expectedVersion: c.version,
      creditEnabled: c.creditEnabled,
      creditLimit: c.creditLimit,
      paymentTermsDays: c.paymentTermsDays,
      reason: '',
    }),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [error, setError] = useState('');
  const key = useRef(crypto.randomUUID()),
    errorRef = useRef<HTMLParagraphElement>(null);
  function update(v: Partial<CreditInput>) {
    setValue((old) => ({ ...old, ...v }));
    key.current = crypto.randomUUID();
    setError('');
  }
  function dismiss() {
    if (
      !busy &&
      (JSON.stringify(value) ===
        JSON.stringify({
          expectedVersion: c.version,
          creditEnabled: c.creditEnabled,
          creditLimit: c.creditLimit,
          paymentTermsDays: c.paymentTermsDays,
          reason: '',
        }) ||
        window.confirm('Discard unsaved credit policy changes?'))
    )
      close();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!review) {
      setReview(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      saved(await api.customerCredit(c.id, value, key.current));
    } catch (e) {
      setError(errorText(e));
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Customer credit policy" subtitle={c.name + ' · ' + c.code} onClose={dismiss}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="customer-dialog-body">
          {error && (
            <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
              {error}
            </p>
          )}
          <p>
            Set the permitted credit limit and payment terms. This does not create a balance or
            record a sale.
          </p>
          <fieldset className="customer-fields" disabled={busy || review}>
            <label className="customer-checkbox">
              <input
                type="checkbox"
                checked={value.creditEnabled}
                disabled={!c.isActive && !value.creditEnabled}
                onChange={(e) =>
                  update({
                    creditEnabled: e.target.checked,
                    creditLimit: e.target.checked ? '' : '0.00',
                    paymentTermsDays: 0,
                  })
                }
              />{' '}
              Enable credit
            </label>
            {!c.isActive && <p>Activate this customer before enabling credit.</p>}
            <label>
              Credit limit (BDT)
              <input
                required
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?"
                disabled={!value.creditEnabled}
                value={value.creditLimit}
                onChange={(e) => update({ creditLimit: e.target.value })}
              />
            </label>
            <label>
              Payment terms (days)
              <input
                type="number"
                min={0}
                max={365}
                required
                disabled={!value.creditEnabled}
                value={value.paymentTermsDays}
                onChange={(e) => update({ paymentTermsDays: Number(e.target.value) })}
              />
            </label>
            <label>
              Reason for change *
              <textarea
                required
                maxLength={500}
                rows={3}
                value={value.reason}
                onChange={(e) => update({ reason: e.target.value })}
              />
            </label>
          </fieldset>
          {review && (
            <div className="customer-warning">
              <strong>Review credit policy</strong>
              <p>
                Previous:{' '}
                {c.creditEnabled
                  ? creditMoney(c.creditLimit) + ' · ' + c.paymentTermsDays + ' days'
                  : 'Disabled'}
              </p>
              <p>
                New:{' '}
                {value.creditEnabled
                  ? creditMoney(value.creditLimit) + ' · ' + value.paymentTermsDays + ' days'
                  : 'Disabled'}
              </p>
              <p>Reason: {value.reason}</p>
              <p>This change will be recorded in credit policy history.</p>
            </div>
          )}
        </div>
        <footer className="dialog-footer customer-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={dismiss}>
            Cancel
          </button>
          {review && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Back
            </button>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? 'Recording…' : review ? 'Confirm policy' : 'Review policy'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
