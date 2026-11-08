import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import type { PaymentSupplier } from './payment-types';
export function ReportSupplierPicker({
  api,
  onSelect,
}: {
  api: StaffApi;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [items, setItems] = useState<PaymentSupplier[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setItems([]);
    setError('');
    const timer = window.setTimeout(() => {
      void api
        .paymentSuppliers(search.trim())
        .then((d) => {
          if (active) setItems(d);
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : 'Unable to find suppliers.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, search]);
  return (
    <section className="panel payment-supplier-picker">
      <h2>Open supplier statement</h2>
      <label>
        Find supplier for statement
        <input
          type="search"
          value={search}
          maxLength={100}
          placeholder="Supplier name or code"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Finding suppliers…</p>
      ) : (
        <div className="payment-supplier-results">
          {items.map((s) => (
            <button className="secondary-button" key={s.id} onClick={() => onSelect(s.id)}>
              {s.name}
              <small>
                {s.code}
                {s.isActive ? '' : ' · Inactive'}
              </small>
            </button>
          ))}
          {!items.length && <p>No matching supplier with recorded invoices.</p>}
        </div>
      )}
    </section>
  );
}
