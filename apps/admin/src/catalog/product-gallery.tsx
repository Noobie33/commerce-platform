import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import type { Product } from './types';
import type { GalleryItem, GalleryView, GalleryInput } from './gallery-types';
import './product-gallery.css';
const keyOf = (x: GalleryItem) => x.kind + ':' + x.id;
export function ProductGallery({
  api,
  product,
  canManage,
  close,
}: {
  api: StaffApi;
  product: Product;
  canManage: boolean;
  close: () => void;
}) {
  const [view, setView] = useState<GalleryView | null>(null),
    [items, setItems] = useState<GalleryItem[]>([]),
    [active, setActive] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [discard, setDiscard] = useState(false),
    [page, setPage] = useState(1);
  const mounted = useRef(true),
    lastManual = useRef(0),
    retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = JSON.stringify(items) !== JSON.stringify(view?.items ?? []) || reason.length > 0;
  const read = useLiveRead(
    useCallback((options) => api.gallery(product.id, page, options), [api, product.id, page]),
    { topics: ['catalog'], allowInDialog: true, paused: dirty || busy },
  );
  const accept = (v: GalleryView) => {
    setView(v);
    setItems(v.items);
    setReason('');
    setDiscard(false);
  };
  useEffect(() => {
    if (read.accessDenied) {
      setView(null);
      setItems([]);
      setReason('');
      return;
    }
    if (read.data && !dirty && (read.checkedAt ?? 0) >= lastManual.current) accept(read.data);
  }, [read.data, read.accessDenied, read.checkedAt, dirty]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function reload() {
    setBusy(true);
    setError('');
    try {
      const v = await api.gallery(product.id, page);
      if (mounted.current) {
        lastManual.current = Date.now();
        accept(v);
        retry.current = null;
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Unable to reload gallery.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (!view || busy) return;
    if (!reason.trim()) {
      setError('Add a reason before saving the gallery draft.');
      return;
    }
    const input: GalleryInput = {
        action: 'save',
        expectedVersion: view.version,
        expectedBasis: view.basis,
        items,
        reason: reason.trim(),
      },
      body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      await api.saveGallery(product.id, input, retry.current.key);
      saved = true;
      const next = await api.gallery(product.id, page);
      if (mounted.current) {
        lastManual.current = Date.now();
        accept(next);
        retry.current = null;
        setNotice('Gallery draft saved. Website publication has not changed.');
      }
    } catch (e) {
      if (mounted.current)
        setError(
          saved
            ? 'Draft saved. Reload this panel to see its current revision.'
            : e instanceof Error
              ? e.message
              : 'Unable to save gallery.',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    setItems((list) => {
      const next = [...list],
        target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setNotice('');
  }
  const selected =
    view?.assets.find((a) => keyOf(a) === active) ??
    view?.assets.find((a) => items[0] && keyOf(a) === keyOf(items[0]));
  return (
    <Dialog
      title="Product gallery"
      subtitle={product.name + ' / private website gallery draft'}
      onClose={() => {
        if (!busy) {
          if (dirty) setDiscard(true);
          else close();
        }
      }}
      wide
    >
      <div className="gallery-workspace">
        <p className="gallery-boundary">
          Arrange photos and videos together. This is a private draft; saving does not publish media
          or change the live website.
        </p>
        <ReadStatus read={read} />
        {read.error && (
          <p role="alert" className="form-error">
            {read.error}
          </p>
        )}
        {error && (
          <p role="alert" className="form-error" ref={errorRef} tabIndex={-1}>
            {error} Your unsaved order is kept.
          </p>
        )}
        {notice && (
          <p role="status" className="form-success">
            {notice}
          </p>
        )}
        {discard && (
          <div className="gallery-discard" role="group" aria-label="Unsaved gallery changes">
            <p>Discard the unsaved order and reason?</p>
            <button className="secondary-button" onClick={() => setDiscard(false)}>
              Keep editing
            </button>
            <button className="secondary-button" onClick={close}>
              Discard and close
            </button>
          </div>
        )}
        {view && (
          <>
            <div className="gallery-layout">
              <section className="gallery-preview" aria-label="Private media preview">
                <h3>Preview</h3>
                {selected?.url ? (
                  selected.kind === 'video' ? (
                    <video
                      key={selected.id}
                      controls
                      preload="metadata"
                      playsInline
                      poster={selected.thumbnailUrl ?? undefined}
                      aria-label={selected.label || 'Private product video'}
                      src={selected.url}
                    />
                  ) : (
                    <img src={selected.url} alt={selected.label || 'Private product photo'} />
                  )
                ) : (
                  <div className="gallery-empty">Choose media to preview it here.</div>
                )}
                <p>{selected?.label || 'Add descriptive labels in media review.'}</p>
                {selected?.variantSku && <p>Variant: {selected.variantSku}</p>}
                <small>Private preview uses staff permissions. Original files are unchanged.</small>
              </section>
              <section className="gallery-order" aria-label="Gallery order">
                <h3>
                  Gallery order <small>({items.length}/40)</small>
                </h3>
                {!items.length && <p>No gallery draft items yet. Add media below.</p>}
                <ol>
                  {items.map((item, index) => {
                    const a = view.assets.find((x) => keyOf(x) === keyOf(item));
                    return (
                      <li key={keyOf(item)}>
                        <button
                          className="gallery-item"
                          aria-pressed={selected?.id === item.id && selected?.kind === item.kind}
                          onClick={() => setActive(keyOf(item))}
                        >
                          {a?.thumbnailUrl && <img src={a.thumbnailUrl} alt="" />}
                          <span>
                            <strong>
                              {index + 1}. {a?.label || 'Unlabelled ' + item.kind}
                            </strong>
                            <small>
                              {item.kind}
                              {a?.primary ? ' / primary photo' : ''} / {a?.state ?? 'unavailable'} /{' '}
                              {a?.reviewState ?? 'not reviewed'}
                              {a?.variantSku ? ' / ' + a.variantSku : ''}
                            </small>
                          </span>
                        </button>
                        {canManage && (
                          <div className="gallery-order-controls">
                            <button
                              className="secondary-button"
                              disabled={busy || index === 0}
                              aria-label={'Move item ' + (index + 1) + ' up'}
                              onClick={() => move(index, -1)}
                            >
                              Up
                            </button>
                            <button
                              className="secondary-button"
                              disabled={busy || index === items.length - 1}
                              aria-label={'Move item ' + (index + 1) + ' down'}
                              onClick={() => move(index, 1)}
                            >
                              Down
                            </button>
                            <button
                              className="secondary-button"
                              disabled={busy}
                              aria-label={'Remove item ' + (index + 1) + ' from gallery'}
                              onClick={() =>
                                setItems((xs) => xs.filter((x) => keyOf(x) !== keyOf(item)))
                              }
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
            <section className="gallery-library" aria-label="Available product media">
              <h3>Available media</h3>
              <p>
                Ready videos can be added. Photo/video review remains separate from arranging a
                draft.
              </p>
              <div>
                {view.assets.map((a) => {
                  const included = items.some((x) => keyOf(x) === keyOf(a));
                  return (
                    <article key={keyOf(a)}>
                      {a.thumbnailUrl && (
                        <button
                          className="gallery-library-preview"
                          aria-label={'Preview ' + (a.label || a.kind)}
                          onClick={() => setActive(keyOf(a))}
                        >
                          <img src={a.thumbnailUrl} alt="" />
                        </button>
                      )}
                      <strong>{a.label || 'Unlabelled ' + a.kind}</strong>
                      <small>
                        {a.kind} / {a.state}
                        {a.primary ? ' / primary photo' : ''}
                      </small>
                      {canManage && (
                        <button
                          className="secondary-button"
                          disabled={busy || included || !a.selectable || items.length >= 40}
                          onClick={() => {
                            setItems((xs) => [...xs, { kind: a.kind, id: a.id }]);
                            setActive(keyOf(a));
                          }}
                        >
                          {included ? 'Added' : !a.selectable ? 'Not ready' : 'Add to gallery'}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
              {!view.assets.length && <p>Add product photos or upload a video first.</p>}
            </section>
            <section className="gallery-checks">
              <h3>Saved draft checks</h3>
              <p>
                These checks describe revision {view.version}. Publishing and public video delivery
                are separate steps.
              </p>
              {view.issues.length ? (
                <ul>
                  {view.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  No media metadata issues detected in the saved order. File integrity,
                  accessibility and public release checks still apply.
                </p>
              )}
            </section>
            {canManage && (
              <section className="gallery-save">
                <label>
                  Reason for this order
                  <textarea
                    value={reason}
                    maxLength={500}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div>
                  <button
                    className="primary-button"
                    disabled={busy || !dirty || !reason.trim()}
                    onClick={() => void save()}
                  >
                    {busy ? 'Working...' : 'Save gallery draft'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || dirty}
                    onClick={() => void reload()}
                  >
                    Check current draft
                  </button>
                  {dirty && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setDiscard(true)}
                    >
                      Review unsaved changes
                    </button>
                  )}
                </div>
              </section>
            )}
            {error && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  if (dirty) setDiscard(true);
                  else void reload();
                }}
              >
                Reload current draft
              </button>
            )}
            <details className="gallery-history">
              <summary>Saved order history</summary>
              {view.history.map((e) => (
                <article key={e.version}>
                  <strong>
                    Revision {e.version} / {e.items.length} items
                  </strong>
                  <p>{e.reason}</p>
                  <small>
                    {e.actorName} /{' '}
                    {new Date(e.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}{' '}
                    (Dhaka)
                  </small>
                </article>
              ))}
              {!view.history.length && <p>No saved draft yet.</p>}
              <button
                className="secondary-button"
                disabled={busy || dirty || page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Newer history
              </button>
              <button
                className="secondary-button"
                disabled={busy || dirty || !view.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Older history
              </button>
            </details>
          </>
        )}
        {!view && read.loading && <p role="status">Loading gallery...</p>}
      </div>
    </Dialog>
  );
}
