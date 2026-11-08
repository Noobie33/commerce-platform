import { useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { categoryName } from './helpers';
import type { Category } from './types';
export function CategoryDialog({
  api,
  categories,
  onClose,
  onCreated,
}: {
  api: StaffApi;
  categories: Category[];
  onClose: () => void;
  onCreated: (category: Category) => void;
}) {
  const [name, setName] = useState(''),
    [parentId, setParent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog
      title="New category"
      subtitle="Organise your collection with clear, reusable categories."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            onCreated(await api.createCategory(name, parentId || null));
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to create category.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-body field-stack">
          <label>
            Category name
            <input
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              disabled={busy}
            />
          </label>
          <label>
            Parent category
            <select value={parentId} onChange={(e) => setParent(e.target.value)} disabled={busy}>
              <option value="">Top-level category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c.id, categories)}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Creating…' : 'Create category'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
