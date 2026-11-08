import { useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
export function LocationDialog({
  api,
  onClose,
  onSaved,
}: {
  api: StaffApi;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(''),
    [name, setName] = useState(''),
    [kind, setKind] = useState<'warehouse' | 'store'>('warehouse'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const close = () => {
    if (!busy && (!(name || code) || window.confirm('Discard this unsaved location?'))) onClose();
  };
  return (
    <Dialog
      title="New location"
      subtitle="Give each warehouse or store its own stock record."
      onClose={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api.createInventoryLocation({ code, name, kind });
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to create location.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-body field-stack">
          <label>
            Location name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Location code
            <input
              required
              minLength={2}
              maxLength={32}
              pattern="[A-Za-z0-9_-]{2,32}"
              placeholder="e.g. WH-01"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
            <span className="small muted">
              Unique code using letters, numbers, hyphens or underscores.
            </span>
          </label>
          <label>
            Location type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              disabled={busy}
            >
              <option value="warehouse">Warehouse</option>
              <option value="store">Store</option>
            </select>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Creating…' : 'Create location'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
