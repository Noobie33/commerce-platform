import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { Product } from './types';
import type { PublicationInput, PublicationView } from './publication-types';
import './content.css';
export function ProductPublication({
  api,
  product,
  canReviewMedia,
  canPublish,
  close,
}: {
  api: StaffApi;
  product: Product;
  canReviewMedia: boolean;
  canPublish: boolean;
  close: () => void;
}) {
  const [view, setView] = useState<PublicationView | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [alts, setAlts] = useState<Record<string, string>>({}),
    [initial, setInitial] = useState('{}');
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    mounted = useRef(true);
  const dirty = reason.length > 0 || JSON.stringify(alts) !== initial;
  const lastManualRead = useRef(0);
  const read = useLiveRead(
    useCallback((options) => api.publication(product.id, page, options), [api, product.id, page]),
    { topics: ['catalog'], allowInDialog: true, paused: dirty || busy },
  );
  useEffect(() => {
    if (read.accessDenied) {
      setView(null);
      setAlts({});
      setInitial('{}');
      return;
    }
    if (read.data && !dirty && (read.checkedAt ?? 0) >= lastManualRead.current) {
      setView(read.data);
      const values = Object.fromEntries(read.data.photos.map((p) => [p.id, p.alt]));
      setAlts(values);
      setInitial(JSON.stringify(values));
    }
  }, [read.data, read.accessDenied, read.checkedAt, dirty]);
  const load = useCallback(async () => {
    const next = await api.publication(product.id, page);
    if (!mounted.current) return;
    lastManualRead.current = Date.now();
    setView(next);
    const values = Object.fromEntries(next.photos.map((p) => [p.id, p.alt]));
    setAlts(values);
    setInitial(JSON.stringify(values));
  }, [api, product.id, page]);
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
  const dismiss = () => {
    if (!busy && (!dirty || window.confirm('Discard unsaved alternative text or reason?'))) close();
  };
  async function act(action: PublicationInput['action'], photoId?: string) {
    if (!view || busy) return;
    if (!reason.trim()) {
      setError('Add a reason before recording a decision.');
      return;
    }
    const input: PublicationInput = {
      action,
      expectedVersion: photoId ? view.photos.find((p) => p.id === photoId)!.version : view.version,
      reason: reason.trim(),
      ...(action === 'approve' ? { alt: alts[photoId!] ?? '' } : {}),
      ...(action === 'publish'
        ? {
            expectedProductVersion: view.productVersion,
            expectedContentVersion: view.contentVersion,
          }
        : {}),
    };
    const body = JSON.stringify({ input, photoId });
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      await api.savePublication(product.id, input, retry.current.key, photoId);
      saved = true;
      const pending = Object.fromEntries(
        view.photos
          .filter((p) => p.id !== photoId && alts[p.id] !== p.alt)
          .map((p) => [p.id, alts[p.id] ?? '']),
      );
      await load();
      setAlts((values) => ({ ...values, ...pending }));
      setReason('');
      setNotice('Decision recorded. The current publication status is shown below.');
    } catch (e) {
      setError(
        saved
          ? 'Decision saved. Reload this panel to see the current state.'
          : e instanceof Error
            ? e.message
            : 'Unable to record decision.',
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Dialog
      title="Website publication"
      subtitle={product.name + ' / ' + product.styleCode}
      onClose={dismiss}
      wide
    >
      <div className="product-content-body">
        <p className="content-boundary">
          Content approval, photo approval and publication are separate decisions. Only an
          explicitly published, currently eligible release is available to the future store.
          Original files remain private.
        </p>
        <ReadStatus read={read} />
        {read.error && (
          <p className="form-error" role="alert">
            {read.error}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!view ? (
          <p>Loading publication details...</p>
        ) : (
          <>
            <section className="content-readiness">
              <h3>Current release</h3>
              <p>
                <strong>
                  {view.effectivePublic
                    ? 'Available through the public product API'
                    : view.state === 'published'
                      ? 'Published release blocked by changed data or approval'
                      : 'Not public'}
                </strong>
              </p>
              <p>
                Release revision {view.version} / Content revision {view.contentVersion}
              </p>
              <p>The customer website and checkout are separate upcoming work.</p>
              {view.galleryReview && (
                <p>
                  Mixed gallery: {view.galleryReview.state.replaceAll('_', ' ')}
                  {view.galleryReview.state === 'approved'
                    ? ' / ' +
                      view.galleryReview.itemCount +
                      ' items / ' +
                      (view.galleryReview.eligible ? 'current approval' : 'changed since approval')
                    : ' / next publish uses photos only'}
                  . Review a mixed order in Product gallery. Gallery approval alone does not publish
                  it.
                </p>
              )}
              {view.issues.length ? (
                <ul>
                  {view.issues.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : (
                <p>Content, category URLs and active photo approvals are prepared.</p>
              )}
            </section>
            <fieldset className="content-fields" disabled={busy}>
              <label>
                Reason for this decision
                <textarea
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain the photo approval, revocation or release decision"
                />
              </label>
            </fieldset>
            <section className="content-readiness">
              <h3>Photo publication approval</h3>
              <p>
                Review every active display photo. Alternative text describes the image for
                customers using assistive technology.
              </p>
              {view.photos.length === 0 ? (
                <p>No active photos. Add product photos first.</p>
              ) : (
                view.photos.map((photo, index) => (
                  <article key={photo.id} className="publication-photo">
                    <img
                      src={photo.thumbnailUrl}
                      alt={'Photo ' + (index + 1) + ' for publication review'}
                      width="112"
                      height="132"
                    />
                    <div>
                      <h4>Photo {index + 1}</h4>
                      <p>
                        {photo.state.replaceAll('_', ' ')} / revision {photo.version}
                      </p>
                      <label htmlFor={'photo-alt-' + photo.id}>Alternative text</label>
                      <input
                        id={'photo-alt-' + photo.id}
                        value={alts[photo.id] ?? ''}
                        maxLength={240}
                        disabled={busy || !canReviewMedia}
                        onChange={(e) => setAlts({ ...alts, [photo.id]: e.target.value })}
                      />
                      {canReviewMedia && (
                        <div className="merch-actions">
                          <button
                            className="secondary-button"
                            disabled={busy || !(alts[photo.id] ?? '').trim()}
                            onClick={() => void act('approve', photo.id)}
                          >
                            Approve display photo
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy || photo.state !== 'approved'}
                            onClick={() => void act('revoke', photo.id)}
                          >
                            Revoke photo approval
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))
              )}
            </section>
            {canPublish && (
              <div className="merch-actions">
                <button
                  className="primary-button"
                  disabled={busy || view.issues.length > 0 || JSON.stringify(alts) !== initial}
                  onClick={() => void act('publish')}
                >
                  Publish approved product
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || view.state !== 'published'}
                  onClick={() => void act('unpublish')}
                >
                  Unpublish product
                </button>
              </div>
            )}
            <section className="content-history">
              <h3>Publication history</h3>
              {view.history.length === 0 ? (
                <p>No publication decisions yet.</p>
              ) : (
                view.history.map((h, i) => (
                  <article key={h.kind + '-' + h.version + '-' + i}>
                    <strong>
                      {h.kind} / {h.action} / revision {h.version}
                    </strong>
                    <p>{h.reason}</p>
                    <small>
                      {new Date(h.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}{' '}
                      (Dhaka)
                    </small>
                  </article>
                ))
              )}
              <div className="merch-actions">
                <button
                  className="secondary-button"
                  disabled={busy || page === 1 || dirty}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Newer publication history
                </button>
                <span>Page {page}</span>
                <button
                  className="secondary-button"
                  disabled={busy || !view.hasMore || dirty}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Older publication history
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}
