import { useCallback, useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { useLiveRead } from '../data/use-live-read';
import type {
  MerchAssignments,
  MerchItem,
  MerchProjection,
  MerchRef,
  MerchSnapshot,
} from './merch-types';
import { MerchDetails } from './merch-details';
import './merch.css';
export function MerchAssignmentsEditor({
  api,
  value,
  projection,
  onChange,
}: {
  api: StaffApi;
  value: MerchAssignments;
  projection: MerchProjection | undefined;
  onChange: (v: MerchAssignments) => void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [known, setKnown] = useState<(MerchItem | MerchSnapshot)[]>(() =>
      projection
        ? [...(projection.sizeGuide ? [projection.sizeGuide] : []), ...projection.collections]
        : [],
    );
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const read = useLiveRead(
    useCallback(
      (options) => api.merchItems({ search: query, page, status: 'active' }, options),
      [api, query, page],
    ),
    { revision, paused: true },
  );
  useEffect(() => {
    if (read.data)
      setKnown((old) => [
        ...old.filter(
          (x) => !read.data!.items.some((y) => x.id === y.id && x.version === y.version),
        ),
        ...read.data!.items,
      ]);
  }, [read.data]);
  const find = (ref: MerchRef) => known.find((x) => x.id === ref.id && x.version === ref.version);
  return (
    <section className="content-full merch-assignments">
      <h3>Size guide & collections</h3>
      <p className="catalog-note">
        Assignments save with this content draft. A selected version stays pinned until you
        explicitly replace it. Size guides do not create or change SKUs.
      </p>
      {value.sizeGuide && (
        <div className="merch-selection">
          <strong>
            {find(value.sizeGuide)?.definition.title ?? 'Selected size guide'} / v
            {value.sizeGuide.version}
          </strong>
          <button
            type="button"
            className="text-button"
            onClick={() => onChange({ ...value, sizeGuide: null })}
          >
            Remove size guide
          </button>
          {find(value.sizeGuide) && <MerchDetails item={find(value.sizeGuide)!} />}
        </div>
      )}
      {value.collections.map((ref) => (
        <div className="merch-selection" key={ref.id}>
          <span>
            {find(ref)?.definition.title ?? 'Selected collection'} / v{ref.version}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange({ ...value, collections: value.collections.filter((x) => x.id !== ref.id) })
            }
          >
            Remove collection {find(ref)?.definition.title ?? ''}
          </button>
        </div>
      ))}
      <label>
        Find a guide or collection
        <input
          type="search"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <button type="button" className="text-button" onClick={() => refresh((n) => n + 1)}>
        Refresh available versions
      </button>
      {read.error && (
        <p className="form-error" role="alert">
          {read.error}
        </p>
      )}
      {read.loading ? (
        <p role="status">Loading available records…</p>
      ) : !read.data?.items.length ? (
        <p>No active records found. Create them in Size guides & collections from the catalog.</p>
      ) : (
        <div className="merch-library-list">
          {read.data.items.map((item) => (
            <div className="merch-library-row" key={item.id}>
              <span>
                {item.definition.title}
                <small>
                  {item.kind === 'size_guide' ? 'Size guide' : 'Collection'} / v{item.version}
                </small>
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={
                  item.kind === 'collection' &&
                  value.collections.length >= 20 &&
                  !value.collections.some((x) => x.id === item.id)
                }
                onClick={() =>
                  onChange(
                    item.kind === 'size_guide'
                      ? { ...value, sizeGuide: { id: item.id, version: item.version } }
                      : {
                          ...value,
                          collections: [
                            ...value.collections.filter((x) => x.id !== item.id),
                            { id: item.id, version: item.version },
                          ].sort((a, b) => a.id.localeCompare(b.id)),
                        },
                  )
                }
              >
                {item.kind === 'size_guide' ? 'Use guide' : 'Use collection'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="merch-actions">
        <button
          type="button"
          className="text-button"
          disabled={page === 1}
          onClick={() => setPage((n) => n - 1)}
        >
          Previous choices
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          className="text-button"
          disabled={page * 20 >= (read.data?.total ?? 0)}
          onClick={() => setPage((n) => n + 1)}
        >
          Next choices
        </button>
      </div>
    </section>
  );
}
