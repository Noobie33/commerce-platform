import { useCallback, useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { useLiveRead } from '../data/use-live-read';
import type { TaxonomyItem } from './presentation-types';
export function CategoryParentPicker({
  api,
  value,
  label,
  blockedId,
  onChange,
}: {
  api: StaffApi;
  value: string | null;
  label: string;
  blockedId: string;
  onChange: (id: string | null, label: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const read = useLiveRead(
    useCallback(
      (options) => api.taxonomy({ search: query, status: 'active', page }, options),
      [api, query, page],
    ),
    { paused: true },
  );
  const eligible = (x: TaxonomyItem) =>
    x.id !== blockedId && !x.path.some((p) => p.id === blockedId);
  return (
    <section className="content-full taxonomy-parent">
      <h3>Parent category</h3>
      <p>{value ? label : 'Top-level category'}</p>
      {value && (
        <button type="button" className="text-button" onClick={() => onChange(null, '')}>
          Make top-level
        </button>
      )}
      <label>
        Find parent category
        <input
          type="search"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {read.error && (
        <p className="form-error" role="alert">
          {read.error}
        </p>
      )}
      {read.loading ? (
        <p role="status">Loading possible parents…</p>
      ) : (
        read.data?.items.filter(eligible).map((x) => (
          <button
            key={x.id}
            type="button"
            className="taxonomy-parent-option"
            onClick={() => onChange(x.id, x.path.map((p) => p.name).join(' / '))}
          >
            {x.path.map((p) => p.name).join(' / ')}
          </button>
        ))
      )}
      <small>The category itself and its descendants cannot be its parent.</small>
      <div className="merch-actions">
        <button
          type="button"
          className="text-button"
          disabled={page === 1}
          onClick={() => setPage((n) => n - 1)}
        >
          Previous parents
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          className="text-button"
          disabled={page * 20 >= (read.data?.total ?? 0)}
          onClick={() => setPage((n) => n + 1)}
        >
          Next parents
        </button>
      </div>
    </section>
  );
}
