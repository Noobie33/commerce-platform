import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/dialog';
import { StaffApi } from '../api';
import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import type { MerchItem, MerchInput, MerchKind, GuideDefinition } from './merch-types';
import { MerchDetails } from './merch-details';
import './merch.css';
export function MerchLibrary({
  api,
  canManage,
  close,
}: {
  api: StaffApi;
  canManage: boolean;
  close: () => void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [edit, setEdit] = useState<MerchInput | null>(null),
    [initial, setInitial] = useState(''),
    [selected, setSelected] = useState<Awaited<ReturnType<StaffApi['merchItem']>> | null>(null),
    [historyPage, setHistoryPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const retry = useRef<{ body: string; key: string } | null>(null),
    opening = useRef(0);
  const dirty = !!edit && JSON.stringify(edit) !== initial;
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);
  const read = useLiveRead(
    useCallback(
      (options) => api.merchItems({ search: query, kind, page }, options),
      [api, query, kind, page],
    ),
    { revision, allowInDialog: true, topics: ['catalog'], paused: !!edit || !!selected },
  );
  useEffect(() => {
    if (read.data && page > Math.max(1, Math.ceil(read.data.total / 20)))
      setPage(Math.max(1, Math.ceil(read.data.total / 20)));
  }, [read.data, page]);
  useEffect(() => {
    if (error || read.error) errorRef.current?.focus();
  }, [error, read.error]);
  const dismiss = () => {
    if (!busy && (!dirty || window.confirm('Discard unsaved guide or collection changes?')))
      close();
  };
  const begin = (item: MerchItem) => {
    const draft = {
      id: item.id,
      kind: item.kind,
      slug: item.slug,
      expectedVersion: item.version,
      definition: structuredClone(item.definition),
      reason: '',
    };
    setEdit(draft);
    setInitial(JSON.stringify(draft));
    setError('');
    setNotice('');
  };
  function create(kind: MerchKind) {
    begin({
      id: crypto.randomUUID(),
      kind,
      slug: '',
      version: 0,
      updatedAt: '',
      definition:
        kind === 'collection'
          ? { title: '', active: true, description: '' }
          : {
              title: '',
              active: true,
              unit: 'cm',
              basis: 'garment',
              instructions: '',
              columns: ['Measurement'],
              rows: [{ size: '', values: [''] }],
            },
    });
    setSelected(null);
  }
  async function open(id: string, p = 1) {
    const ticket = ++opening.current;
    setError('');
    try {
      const value = await api.merchItem(id, p);
      if (ticket === opening.current) {
        setSelected(value);
        setHistoryPage(p);
      }
    } catch (e) {
      if (ticket === opening.current)
        setError(e instanceof Error ? e.message : 'Unable to load guide.');
    }
  }
  function definition(change: Partial<MerchInput['definition']>) {
    setEdit((old) =>
      old
        ? { ...old, definition: { ...old.definition, ...change } as MerchInput['definition'] }
        : old,
    );
    setError('');
  }
  function convention(key: 'unit' | 'basis', value: string) {
    if (!edit || !('rows' in edit.definition)) return;
    const d = edit.definition;
    if (
      d.rows.some((r) => r.values.some(Boolean)) &&
      !window.confirm('Changing the measurement convention clears the grid values. Continue?')
    )
      return;
    definition({
      [key]: value,
      rows: d.rows.map((r) => ({ ...r, values: r.values.map(() => '') })),
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || busy) return;
    const body = JSON.stringify(edit);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    let recorded = false;
    try {
      await api.saveMerch(edit, retry.current.key);
      recorded = true;
      setEdit(null);
      refresh((n) => n + 1);
      await open(edit.id);
      setNotice('New version saved. Existing product assignments keep their selected version.');
    } catch (e) {
      setError(
        recorded
          ? 'Saved. Reopen the record to load its latest state.'
          : e instanceof Error
            ? e.message
            : 'Unable to save.',
      );
    } finally {
      setBusy(false);
    }
  }
  const guide = edit && 'rows' in edit.definition ? edit.definition : null;
  return (
    <Dialog
      title="Size guides & collections"
      subtitle="Reusable, versioned product presentation"
      onClose={dismiss}
      wide
    >
      <div className="product-content-body">
        <p className="content-boundary">
          Measurement revisions stay separate from SKU sizes and stock. Collections can group a
          product in several ways. These records are not published online.
        </p>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {(error || read.error) && (
          <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error || read.error}
          </p>
        )}
        {edit ? (
          <form onSubmit={save}>
            <fieldset className="content-fields" disabled={busy}>
              <label>
                Title
                <input
                  required
                  maxLength={120}
                  value={edit.definition.title}
                  onChange={(e) => definition({ title: e.target.value })}
                />
              </label>
              <label>
                Permanent URL name
                <input
                  required
                  maxLength={120}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  disabled={edit.expectedVersion > 0}
                  value={edit.slug}
                  onChange={(e) => setEdit({ ...edit, slug: e.target.value })}
                />
                <small>Lowercase letters, numbers and hyphens. Fixed after creation.</small>
              </label>
              <label className="merch-checkbox">
                <input
                  type="checkbox"
                  checked={edit.definition.active}
                  onChange={(e) => definition({ active: e.target.checked })}
                />
                Available for product assignment
              </label>
              {guide ? (
                <>
                  <label>
                    Measurement basis
                    <select
                      value={guide.basis}
                      onChange={(e) => convention('basis', e.target.value)}
                    >
                      <option value="garment">Garment measurements</option>
                      <option value="body">Body measurements</option>
                    </select>
                  </label>
                  <label>
                    Unit
                    <select value={guide.unit} onChange={(e) => convention('unit', e.target.value)}>
                      <option value="cm">Centimetres (cm)</option>
                      <option value="in">Inches (in)</option>
                    </select>
                  </label>
                  <label className="content-full">
                    How to measure
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={guide.instructions}
                      onChange={(e) => definition({ instructions: e.target.value })}
                    />
                  </label>
                  <section className="content-full">
                    <h3>Measurements by size</h3>
                    <p className="catalog-note">
                      Enter positive measurements with up to two decimal places. Values are stored
                      exactly; switching units does not silently convert them.
                    </p>
                    <div className="merch-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Size label</th>
                            {guide.columns.map((c, j) => (
                              <th key={j}>
                                <input
                                  aria-label={'Measurement column ' + (j + 1)}
                                  required
                                  maxLength={40}
                                  value={c}
                                  onChange={(e) =>
                                    definition({
                                      columns: guide.columns.map((x, k) =>
                                        k === j ? e.target.value : x,
                                      ),
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={guide.columns.length === 1}
                                  onClick={() =>
                                    definition({
                                      columns: guide.columns.filter((_, k) => k !== j),
                                      rows: guide.rows.map((r) => ({
                                        ...r,
                                        values: r.values.filter((_, k) => k !== j),
                                      })),
                                    })
                                  }
                                >
                                  Remove column {j + 1}
                                </button>
                              </th>
                            ))}
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {guide.rows.map((r, i) => (
                            <tr key={i}>
                              <td>
                                <input
                                  aria-label={'Size label ' + (i + 1)}
                                  required
                                  maxLength={30}
                                  value={r.size}
                                  onChange={(e) =>
                                    definition({
                                      rows: guide.rows.map((x, k) =>
                                        k === i ? { ...x, size: e.target.value } : x,
                                      ),
                                    })
                                  }
                                />
                              </td>
                              {r.values.map((v, j) => (
                                <td key={j}>
                                  <input
                                    aria-label={'Row ' + (i + 1) + ' measurement ' + (j + 1)}
                                    required
                                    inputMode="decimal"
                                    maxLength={7}
                                    value={v}
                                    onChange={(e) =>
                                      definition({
                                        rows: guide.rows.map((x, k) =>
                                          k === i
                                            ? {
                                                ...x,
                                                values: x.values.map((z, n) =>
                                                  n === j ? e.target.value : z,
                                                ),
                                              }
                                            : x,
                                        ),
                                      })
                                    }
                                  />
                                </td>
                              ))}
                              <td>
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={guide.rows.length === 1}
                                  onClick={() =>
                                    definition({ rows: guide.rows.filter((_, k) => k !== i) })
                                  }
                                >
                                  Remove row {i + 1}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="merch-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={guide.columns.length >= 8}
                        onClick={() =>
                          definition({
                            columns: [...guide.columns, ''],
                            rows: guide.rows.map((r) => ({ ...r, values: [...r.values, ''] })),
                          })
                        }
                      >
                        Add measurement
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={guide.rows.length >= 30}
                        onClick={() =>
                          definition({
                            rows: [
                              ...guide.rows,
                              { size: '', values: guide.columns.map(() => '') },
                            ],
                          })
                        }
                      >
                        Add size
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <label className="content-full">
                  Collection description
                  <textarea
                    rows={4}
                    maxLength={1000}
                    value={'description' in edit.definition ? edit.definition.description : ''}
                    onChange={(e) => definition({ description: e.target.value })}
                  />
                </label>
              )}
              <label className="content-full">
                Reason for this version
                <textarea
                  required
                  maxLength={500}
                  rows={2}
                  value={edit.reason}
                  onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                />
              </label>
            </fieldset>
            <div className="merch-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  if (!dirty || window.confirm('Discard unsaved changes?')) setEdit(null);
                }}
              >
                Cancel editing
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : 'Save new version'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="merch-actions">
              {canManage && (
                <>
                  <button className="primary-button" onClick={() => create('size_guide')}>
                    New size guide
                  </button>
                  <button className="secondary-button" onClick={() => create('collection')}>
                    New collection
                  </button>
                </>
              )}
              <button
                className="secondary-button"
                onClick={() => {
                  setSelected(null);
                  refresh((n) => n + 1);
                }}
              >
                Refresh library
              </button>
            </div>
            <ReadStatus read={read} />
            <div className="content-fields">
              <label>
                Search library
                <input
                  type="search"
                  value={search}
                  maxLength={100}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Library type
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                    setSelected(null);
                  }}
                >
                  <option value="all">All types</option>
                  <option value="size_guide">Size guides</option>
                  <option value="collection">Collections</option>
                </select>
              </label>
            </div>
            {read.loading ? (
              <p role="status">Loading library…</p>
            ) : read.data?.items.length ? (
              <div className="merch-library-list">
                {read.data.items.map((item) => (
                  <button
                    className="merch-library-row"
                    key={item.id}
                    onClick={() => void open(item.id)}
                  >
                    <span>
                      <strong>{item.definition.title}</strong>
                      <small>
                        {item.kind === 'size_guide' ? 'Size guide' : 'Collection'} / {item.slug}
                      </small>
                    </span>
                    <span>
                      v{item.version} / {item.definition.active ? 'Active' : 'Retired'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p>No guides or collections in this view.</p>
            )}
            <div className="merch-actions">
              <button
                className="secondary-button"
                disabled={page === 1 || read.loading}
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n - 1);
                }}
              >
                Previous library page
              </button>
              <span>
                Page {page} of {Math.max(1, Math.ceil((read.data?.total ?? 0) / 20))}
              </span>
              <button
                className="secondary-button"
                disabled={
                  page >= Math.max(1, Math.ceil((read.data?.total ?? 0) / 20)) || read.loading
                }
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n + 1);
                }}
              >
                Next library page
              </button>
            </div>
            {selected && (
              <section className="merch-history">
                <div className="merch-actions">
                  <h3>{selected.item.definition.title}</h3>
                  {canManage && (
                    <button className="secondary-button" onClick={() => begin(selected.item)}>
                      Edit latest version
                    </button>
                  )}
                </div>
                <p className="catalog-note">
                  Existing products keep pinned versions. Retiring a record blocks new assignment
                  and requires attached content to be reviewed.
                </p>
                {selected.history.map((h) => (
                  <details key={h.version}>
                    <summary>
                      Version {h.version} / {new Date(h.createdAt).toLocaleDateString('en-GB')} /{' '}
                      {h.definition.active ? 'Active' : 'Retired'}
                    </summary>
                    <p>Reason: {h.reason}</p>
                    <MerchDetails
                      item={{ ...selected.item, version: h.version, definition: h.definition }}
                    />
                  </details>
                ))}
                <div className="merch-actions">
                  <button
                    className="secondary-button"
                    disabled={historyPage === 1}
                    onClick={() => void open(selected.item.id, historyPage - 1)}
                  >
                    Newer versions
                  </button>
                  <button
                    className="secondary-button"
                    disabled={historyPage * 20 >= selected.total}
                    onClick={() => void open(selected.item.id, historyPage + 1)}
                  >
                    Older versions
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
