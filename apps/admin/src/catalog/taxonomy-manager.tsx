import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import type { TaxonomyInput, TaxonomyItem } from './presentation-types';
import { SeoFields, SearchPreview } from './search-preview';
import { CategoryParentPicker } from './category-parent-picker';
import './presentation.css';
export function TaxonomyManager({
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
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [edit, setEdit] = useState<TaxonomyInput | null>(null),
    [initial, setInitial] = useState(''),
    [parentLabel, setParentLabel] = useState(''),
    [selected, setSelected] = useState<Awaited<ReturnType<StaffApi['taxonomyItem']>> | null>(null),
    [historyPage, setHistoryPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const retry = useRef<{ body: string; key: string } | null>(null),
    opening = useRef(0),
    errorRef = useRef<HTMLParagraphElement>(null);
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
      (options) => api.taxonomy({ search: query, status, page }, options),
      [api, query, status, page],
    ),
    { revision, topics: ['catalog'], allowInDialog: true, paused: !!edit || !!selected },
  );
  useEffect(() => {
    if (error || read.error) errorRef.current?.focus();
  }, [error, read.error]);
  useEffect(() => {
    if (read.data && page > Math.max(1, Math.ceil(read.data.total / 20)))
      setPage(Math.max(1, Math.ceil(read.data.total / 20)));
  }, [read.data, page]);
  const dismiss = () => {
    if (!busy && (!dirty || window.confirm('Discard unsaved category changes?'))) close();
  };
  function begin(item: TaxonomyItem) {
    const draft: TaxonomyInput = {
      id: item.id,
      expectedVersion: item.version,
      name: item.name,
      parentId: item.parentId,
      active: item.active,
      slug: item.slug ?? '',
      seo: { ...item.seo },
      reason: '',
    };
    setEdit(draft);
    setInitial(JSON.stringify(draft));
    setParentLabel(
      item.path
        .slice(0, -1)
        .map((x) => x.name)
        .join(' / '),
    );
    setError('');
    setNotice('');
  }
  async function open(id: string, p = 1) {
    const ticket = ++opening.current;
    setError('');
    try {
      const x = await api.taxonomyItem(id, p);
      if (ticket === opening.current) {
        setSelected(x);
        setHistoryPage(p);
      }
    } catch (e) {
      if (ticket === opening.current)
        setError(e instanceof Error ? e.message : 'Unable to load category.');
    }
  }
  function create() {
    begin({
      id: crypto.randomUUID(),
      name: '',
      parentId: null,
      active: true,
      version: 0,
      slug: null,
      seo: { title: '', description: '' },
      path: [],
      activeProducts: 0,
    });
    setSelected(null);
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
      await api.saveTaxonomy(edit, retry.current.key);
      recorded = true;
      setEdit(null);
      refresh((n) => n + 1);
      await open(edit.id);
      setNotice('Category revision saved. Existing product and stock identifiers are unchanged.');
    } catch (e) {
      setError(
        recorded
          ? 'Saved. Reopen the category to see its latest state.'
          : e instanceof Error
            ? e.message
            : 'Unable to save category.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Categories & SEO"
      subtitle="Navigation, search appearance and preserved URL names"
      onClose={dismiss}
      wide
    >
      <div className="product-content-body">
        <p className="content-boundary">
          Category changes keep existing product IDs and history. Moving a category changes its
          navigation path. Retire only after active products and child categories are moved or
          retired.
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
                Category name
                <input
                  required
                  maxLength={80}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label>
                Category URL name
                <input
                  maxLength={120}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={edit.slug}
                  onChange={(e) => setEdit({ ...edit, slug: e.target.value })}
                />
                <small>
                  Lowercase letters, numbers and hyphens. Previous names stay reserved for this
                  category. Optional until website preparation.
                </small>
              </label>
              <label className="merch-checkbox">
                <input
                  type="checkbox"
                  checked={edit.active}
                  onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
                />
                Active category
              </label>
              <CategoryParentPicker
                api={api}
                value={edit.parentId}
                label={parentLabel}
                blockedId={edit.id}
                onChange={(parentId, label) => {
                  setEdit({ ...edit, parentId });
                  setParentLabel(label);
                }}
              />
              <SeoFields value={edit.seo} onChange={(seo) => setEdit({ ...edit, seo })} />
              <label className="content-full">
                Reason for this revision
                <input
                  required
                  maxLength={500}
                  value={edit.reason}
                  onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                />
              </label>
            </fieldset>
            <SearchPreview
              name={edit.name}
              path={'/categories/' + (edit.slug || 'category-url')}
              description=""
              seo={edit.seo}
            />
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
                {busy ? 'Saving…' : 'Save category revision'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="merch-actions">
              {canManage && (
                <button className="primary-button" onClick={create}>
                  New category with SEO
                </button>
              )}
              <button
                className="secondary-button"
                onClick={() => {
                  setSelected(null);
                  refresh((n) => n + 1);
                }}
              >
                Refresh categories
              </button>
            </div>
            <ReadStatus read={read} />
            <div className="content-fields">
              <label>
                Search categories
                <input
                  type="search"
                  maxLength={100}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Category status
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All categories</option>
                  <option value="active">Active</option>
                  <option value="retired">Retired</option>
                </select>
              </label>
            </div>
            {read.loading ? (
              <p role="status">Loading categories…</p>
            ) : read.data?.items.length ? (
              <div className="merch-library-list">
                {read.data.items.map((x) => (
                  <button className="merch-library-row" key={x.id} onClick={() => void open(x.id)}>
                    <span>
                      <strong>{x.path.map((p) => p.name).join(' / ')}</strong>
                      <small>
                        {x.slug ?? 'URL name not prepared'} / {x.activeProducts} active products
                      </small>
                    </span>
                    <span>
                      {x.active ? 'Active' : 'Retired'} /{' '}
                      {x.version ? 'revision ' + x.version : 'SEO not prepared'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p>No categories in this view.</p>
            )}
            <div className="merch-actions">
              <button
                className="secondary-button"
                disabled={page === 1}
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n - 1);
                }}
              >
                Previous categories
              </button>
              <span>
                Page {page} of {Math.max(1, Math.ceil((read.data?.total ?? 0) / 20))}
              </span>
              <button
                className="secondary-button"
                disabled={page * 20 >= (read.data?.total ?? 0)}
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n + 1);
                }}
              >
                Next categories
              </button>
            </div>
            {selected && (
              <section className="merch-history">
                <div className="merch-actions">
                  <h3>{selected.item.path.map((x) => x.name).join(' / ')}</h3>
                  {canManage && (
                    <button className="secondary-button" onClick={() => begin(selected.item)}>
                      Edit category
                    </button>
                  )}
                </div>
                <SearchPreview
                  name={selected.item.name}
                  path={'/categories/' + (selected.item.slug ?? 'category-url')}
                  description=""
                  seo={selected.item.seo}
                />
                <h4>Reserved URL names</h4>
                {selected.routes.length ? (
                  <ul>
                    {selected.routes.map((route) => (
                      <li key={route}>
                        {route}
                        {route === selected.item.slug ? ' (current)' : ' (previous)'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No URL name assigned.</p>
                )}
                {selected.history.map((h) => (
                  <details key={h.version}>
                    <summary>
                      Revision {h.version} /{' '}
                      {new Date(h.createdAt).toLocaleDateString('en-GB', {
                        timeZone: 'Asia/Dhaka',
                      })}
                    </summary>
                    <p>{h.reason}</p>
                    <dl>
                      <dt>Name</dt>
                      <dd>{h.snapshot.name}</dd>
                      <dt>URL name</dt>
                      <dd>{h.snapshot.slug ?? 'Not assigned'}</dd>
                      <dt>Status</dt>
                      <dd>{h.snapshot.active ? 'Active' : 'Retired'}</dd>
                    </dl>
                  </details>
                ))}
                <div className="merch-actions">
                  <button
                    className="secondary-button"
                    disabled={historyPage === 1}
                    onClick={() => void open(selected.item.id, historyPage - 1)}
                  >
                    Newer category history
                  </button>
                  <button
                    className="secondary-button"
                    disabled={historyPage * 20 >= Math.max(selected.total, selected.routeTotal)}
                    onClick={() => void open(selected.item.id, historyPage + 1)}
                  >
                    Older category history
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
