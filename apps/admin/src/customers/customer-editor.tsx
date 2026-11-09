import { useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { Customer, CustomerInput, CustomerAddress } from './types';
import { blank, errorText } from './helpers';
export function CustomerEditor({
  api,
  initial,
  close,
  saved,
}: {
  api: StaffApi;
  initial: Customer | null;
  close: () => void;
  saved: (r: { id: string }) => void;
}) {
  const initialValue = initial
    ? (Object.fromEntries(
        Object.keys(blank()).map((k) => [k, initial[k as keyof Customer]]),
      ) as unknown as CustomerInput)
    : blank();
  const [value, setValue] = useState<CustomerInput>(initialValue),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [matches, setMatches] = useState<{ code: string; name: string }[]>([]),
    [matchError, setMatchError] = useState('');
  const key = useRef(crypto.randomUUID()),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = JSON.stringify(value) !== JSON.stringify(initialValue);
  function update<K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) {
    setValue((old) => ({ ...old, [k]: v }));
    key.current = crypto.randomUUID();
    setError('');
  }
  useEffect(() => {
    let live = true;
    setMatches([]);
    setMatchError('');
    if (!value.phone && !value.email) return;
    const timer = setTimeout(() => {
      void api
        .customerMatches(value.phone, value.email, initial?.id)
        .then((r) => {
          if (live) setMatches(r.items);
        })
        .catch((e) => {
          if (live) setMatchError(errorText(e));
        });
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, value.phone, value.email, initial?.id]);
  function dismiss() {
    if (!busy && (!dirty || window.confirm('Discard unsaved customer changes?'))) close();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.saveCustomer(
        initial?.id ?? null,
        { ...value, ...(initial ? { expectedVersion: initial.version } : {}) },
        key.current,
      );
      saved(r);
    } catch (e) {
      setError(errorText(e));
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={initial ? 'Edit customer' : 'New customer'}
      subtitle="Contact details stay in your staff workspace. Customer codes are generated automatically."
      onClose={dismiss}
      wide
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="customer-dialog-body">
          {error && (
            <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
              {error}
            </p>
          )}
          <fieldset disabled={busy} className="customer-fields">
            <label>
              Customer name *
              <input
                required
                maxLength={140}
                value={value.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </label>
            <div className="customer-address-grid">
              <label>
                Customer type
                <select
                  value={value.customerKind}
                  onChange={(e) =>
                    update('customerKind', e.target.value as CustomerInput['customerKind'])
                  }
                >
                  <option value="person">Person</option>
                  <option value="business">Business</option>
                </select>
              </label>
              <label>
                Sales segment
                <select
                  value={value.segment}
                  onChange={(e) => update('segment', e.target.value as CustomerInput['segment'])}
                >
                  <option value="retail">Retail</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="both">Retail & wholesale</option>
                </select>
              </label>
            </div>
            <label>
              Contact person
              <input
                maxLength={120}
                value={value.contactName}
                onChange={(e) => update('contactName', e.target.value)}
              />
            </label>
            <div className="customer-address-grid">
              <label>
                Phone
                <input
                  type="tel"
                  maxLength={80}
                  value={value.phone}
                  onChange={(e) => update('phone', e.target.value)}
                />
                <small>Local 01… or full international number with +.</small>
              </label>
              <label>
                Email
                <input
                  type="email"
                  maxLength={160}
                  value={value.email}
                  onChange={(e) => update('email', e.target.value)}
                />
              </label>
            </div>
            {matches.length > 0 && (
              <p className="customer-warning" role="status">
                Shared contact found: {matches.map((m) => m.name + ' (' + m.code + ')').join(', ')}.
                Check for duplicates before saving. Shared contacts are allowed.
              </p>
            )}
            {matchError && (
              <p className="customer-warning" role="status">
                Contact check unavailable: {matchError} You can still save.
              </p>
            )}
            {(['billingAddress', 'deliveryAddress'] as const).map((k) => (
              <details key={k} open={value[k] !== null}>
                <summary>
                  {k === 'billingAddress' ? 'Billing address' : 'Delivery address'} · Bangladesh
                </summary>
                {k === 'deliveryAddress' && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!value.billingAddress}
                    onClick={() =>
                      update(k, value.billingAddress ? { ...value.billingAddress } : null)
                    }
                  >
                    Copy billing address
                  </button>
                )}
                {value[k] ? (
                  <>
                    <AddressFields value={value[k]!} change={(a) => update(k, a)} />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => update(k, null)}
                    >
                      Remove {k === 'billingAddress' ? 'billing' : 'delivery'} address
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      update(k, { line1: '', line2: '', area: '', district: '', postalCode: '' })
                    }
                  >
                    Add {k === 'billingAddress' ? 'billing' : 'delivery'} address
                  </button>
                )}
              </details>
            ))}
            <label>
              Internal notes
              <textarea
                maxLength={1000}
                rows={3}
                value={value.notes}
                onChange={(e) => update('notes', e.target.value)}
              />
            </label>
            <label className="customer-checkbox">
              <input
                type="checkbox"
                checked={value.isActive}
                onChange={(e) => update('isActive', e.target.checked)}
              />{' '}
              Active customer
            </label>
            <p>Inactive customers remain in your records. Credit policy is managed separately.</p>
          </fieldset>
        </div>
        <footer className="dialog-footer customer-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={dismiss}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save customer'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function AddressFields({
  value,
  change,
}: {
  value: CustomerAddress;
  change: (v: CustomerAddress) => void;
}) {
  return (
    <div className="customer-fields">
      {(['line1', 'line2', 'area', 'district', 'postalCode'] as const).map((k) => (
        <label key={k}>
          {
            {
              line1: 'Address line 1 *',
              line2: 'Address line 2',
              area: 'Area / upazila',
              district: 'District',
              postalCode: 'Postal code',
            }[k]
          }
          <input
            required={k === 'line1'}
            inputMode={k === 'postalCode' ? 'numeric' : undefined}
            maxLength={k === 'postalCode' ? 4 : k === 'area' || k === 'district' ? 100 : 240}
            value={value[k]}
            onChange={(e) => change({ ...value, [k]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
