import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { Supplier, SupplierInput } from './types';
export function SupplierDialog({
  api,
  initial,
  canManage,
  onClose,
  onSaved,
}: {
  api: StaffApi;
  initial: Supplier | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (s: Supplier) => void;
}) {
  const [draft, setDraft] = useState<SupplierInput>(() => ({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    contactName: initial?.contactName ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    taxReference: initial?.taxReference ?? '',
    notes: initial?.notes ?? '',
    isActive: initial?.isActive ?? true,
  }));
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [dirty]);
  const close = () => {
    if (!busy && (!dirty || window.confirm('Discard your unsaved supplier changes?'))) onClose();
  };
  const field = (key: keyof SupplierInput, value: string | boolean) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const input = (
    key: 'code' | 'name' | 'contactName' | 'phone' | 'email' | 'taxReference',
    label: string,
    max: number,
  ) => (
    <label key={key}>
      {label}
      <input
        value={draft[key]}
        maxLength={max}
        required={key === 'code' || key === 'name'}
        type={key === 'email' ? 'email' : 'text'}
        readOnly={!canManage || (key === 'code' && !!initial)}
        disabled={busy}
        onChange={(e) => field(key, e.target.value)}
        autoComplete="off"
      />
    </label>
  );
  return (
    <Dialog
      title={initial ? (canManage ? 'Edit supplier' : 'Supplier details') : 'New supplier'}
      subtitle="Reusable supplier details for purchasing. Issued orders keep their own snapshot."
      onClose={close}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canManage || stale) return;
          setBusy(true);
          setError('');
          try {
            const body = { ...draft, ...(initial ? { expectedVersion: initial.version } : {}) },
              serialized = JSON.stringify(body);
            if (retry.current?.body !== serialized)
              retry.current = { body: serialized, key: crypto.randomUUID() };
            onSaved(await api.saveSupplier(initial?.id ?? null, body, retry.current.key));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to save supplier.');
            setStale(err instanceof ApiError && err.code === 'STALE_PURCHASING_RECORD');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-body field-stack">
          <div className="editor-grid">
            {input('code', 'Supplier code', 32)}
            {input('name', 'Supplier name', 140)}
            {input('contactName', 'Contact person', 120)}
            {input('phone', 'Phone', 50)}
            {input('email', 'Email', 160)}
            {input('taxReference', 'Tax reference (optional)', 80)}
          </div>
          <label>
            Address
            <textarea
              rows={3}
              maxLength={1000}
              value={draft.address}
              readOnly={!canManage}
              disabled={busy}
              onChange={(e) => field('address', e.target.value)}
            />
          </label>
          <label>
            Internal notes
            <textarea
              rows={3}
              maxLength={1000}
              value={draft.notes}
              readOnly={!canManage}
              disabled={busy}
              onChange={(e) => field('notes', e.target.value)}
            />
          </label>
          <label>
            Status
            <select
              aria-label="Supplier status"
              value={draft.isActive ? 'active' : 'inactive'}
              disabled={busy || !canManage}
              onChange={(e) => field('isActive', e.target.value === 'active')}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <p className="small muted">
            Inactive suppliers stay in history. New purchase orders require an active supplier.
            Balances and payments will be added separately.
          </p>
          {error && (
            <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
              {error}
              {stale ? ' Close and reopen this supplier to load its latest version.' : ''}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>
            {canManage ? 'Cancel' : 'Close'}
          </button>
          {canManage && (
            <button className="primary-button" disabled={busy || stale}>
              {busy ? 'Saving…' : 'Save supplier'}
            </button>
          )}
        </footer>
      </form>
    </Dialog>
  );
}
