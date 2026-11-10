import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog } from '../components/dialog';
import { StaffApi, ApiError } from '../api';
import { useLiveRead } from '../data/use-live-read';
import type { Product } from './types';
import type { ProductVideo, VideoHistory } from './video-types';
import './product-videos.css';
const label = (s: string) => s.replaceAll('_', ' ');
export function ProductVideos({
  api,
  product,
  canManage,
  canReview,
  close,
}: {
  api: StaffApi;
  product: Product;
  canManage: boolean;
  canReview: boolean;
  close: () => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [page, setPage] = useState(1),
    [removed, setRemoved] = useState(false),
    [selected, setSelected] = useState<ProductVideo | null>(null),
    [description, setDescription] = useState(''),
    [variant, setVariant] = useState(''),
    [position, setPosition] = useState(0),
    [reason, setReason] = useState(''),
    [rights, setRights] = useState(false),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirmClose, setConfirmClose] = useState(false),
    [history, setHistory] = useState<VideoHistory | null>(null);
  const controller = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null),
    uploadRetry = useRef<{ file: File; version: number; key: string } | null>(null),
    actionRetry = useRef<{ body: string; key: string } | null>(null);
  const metadataDirty =
    !!selected &&
    (description !== selected.description ||
      variant !== (selected.variantId ?? '') ||
      position !== selected.position);
  const dirty = !!selected && (metadataDirty || !!reason || rights);
  const read = useLiveRead(
    useCallback(
      (options) => api.productVideos(product.id, page, removed, options),
      [api, product.id, page, removed],
    ),
    { topics: ['catalog'], allowInDialog: true, paused: busy || dirty },
  );
  const data = read.data;
  const choose = (v: ProductVideo) => {
    setSelected(v);
    setDescription(v.description);
    setVariant(v.variantId ?? '');
    setPosition(v.position);
    setReason('');
    setRights(false);
    setHistory(null);
    setError('');
  };
  useEffect(() => {
    if (!data || busy || dirty) return;
    const current = data.items.find((v) => v.id === selected?.id);
    if (current) {
      setSelected(current);
      setDescription(current.description);
      setVariant(current.variantId ?? '');
      setPosition(current.position);
    } else if (selected) setSelected(null);
  }, [data, busy, dirty, selected?.id]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty || busy || file) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => {
      window.removeEventListener('beforeunload', fn);
    };
  }, [dirty, busy, file]);
  useEffect(() => () => controller.current?.abort(), []);
  function requestClose() {
    if (dirty || busy || file) setConfirmClose(true);
    else close();
  }
  async function upload() {
    if (!file || !data) return;
    setError('');
    setNotice('');
    if (file.size > data.policy.maxSourceBytes || !/\.(mp4|mov)$/i.test(file.name)) {
      setError('Choose an MP4/MOV within the displayed size limit.');
      return;
    }
    if (!uploadRetry.current || uploadRetry.current.file !== file)
      uploadRetry.current = { file, version: data.productVersion, key: crypto.randomUUID() };
    const retry = uploadRetry.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    setProgress(0);
    try {
      const r = await api.uploadVideo(
        product.id,
        retry.version,
        file,
        retry.key,
        setProgress,
        c.signal,
      );
      setNotice(
        'Video received privately. Background processing can continue after you close this screen.',
      );
      uploadRetry.current = null;
      setFile(null);
      setShowUpload(false);
      if (input.current) input.current.value = '';
      setSelected(null);
      read.refresh();
      void r;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VIDEO_STALE') {
        uploadRetry.current = null;
        read.refresh();
      }
      setError(e instanceof Error ? e.message : 'Video upload failed.');
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  async function action(op: string) {
    if (!selected) return;
    setError('');
    setNotice('');
    if (!reason.trim()) {
      setError('Add a reason for the video action.');
      return;
    }
    const b = {
        action: op,
        expectedVersion: selected.version,
        reason: reason.trim(),
        ...(op === 'metadata' ? { description, variantId: variant || null, position } : {}),
        ...(op === 'approve' ? { rightsConfirmed: rights } : {}),
      },
      raw = JSON.stringify(b);
    if (!actionRetry.current || actionRetry.current.body !== raw)
      actionRetry.current = { body: raw, key: crypto.randomUUID() };
    setBusy(true);
    try {
      await api.videoAction(selected.id, b, actionRetry.current.key);
      actionRetry.current = null;
      setReason('');
      setRights(false);
      setSelected(null);
      setHistory(null);
      setNotice(
        op === 'approve'
          ? 'Video approved privately. Website publication remains separate.'
          : 'Video action saved and recorded.',
      );
      read.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Video action failed.');
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory(n = 1) {
    if (!selected) return;
    try {
      setHistory(await api.videoHistory(selected.id, n));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'History unavailable.');
    }
  }
  return (
    <Dialog title="Product videos" onClose={requestClose} wide>
      <div className="video-workspace">
        <p className="catalog-note">
          {product.name} / Videos remain private here. Processing and approval do not publish them
          to the website.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="form-success">
            {notice}
          </p>
        )}
        {read.error && <p role="alert">{read.error}</p>}
        {data && (
          <>
            <p className="catalog-note">
              Up to {Math.round(data.policy.maxSourceBytes / 1024 / 1024)} MB per clip / up to{' '}
              {data.policy.maxDurationSeconds} seconds / SDR MP4/MOV / original preserved
            </p>
            {canManage && data.items.length > 0 && (
              <button
                className="secondary-button"
                aria-expanded={showUpload}
                disabled={busy || dirty || !!file}
                onClick={() => setShowUpload((v) => !v)}
              >
                {showUpload ? 'Hide upload form' : 'Add another video'}
              </button>
            )}
            {canManage && (showUpload || data.items.length === 0) && (
              <section className="video-upload">
                <h3>Add a product video</h3>
                {!data.enabled && (
                  <p role="status">Video intake is disabled in this environment.</p>
                )}
                <label>
                  Choose MP4 or MOV
                  <input
                    ref={input}
                    type="file"
                    accept="video/mp4,video/quicktime,.mp4,.mov"
                    disabled={busy || !data.enabled}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setError('');
                    }}
                  />
                </label>
                {file && (
                  <p>
                    {file.name} / {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                )}
                <button
                  className="primary-button"
                  disabled={busy || dirty || !file || !data.enabled}
                  onClick={() => void upload()}
                >
                  {busy && controller.current ? 'Uploading...' : 'Upload privately'}
                </button>
                {busy && controller.current && (
                  <>
                    <progress aria-label="Video upload progress" max={100} value={progress} />
                    <span>
                      {progress}% {progress === 100 ? '- confirming queue entry' : ''}
                    </span>
                    <button
                      className="secondary-button"
                      onClick={() => controller.current?.abort()}
                    >
                      Cancel upload
                    </button>
                  </>
                )}
              </section>
            )}
            <div className="video-list-controls">
              <label>
                <input
                  type="checkbox"
                  checked={removed}
                  disabled={busy || dirty}
                  onChange={(e) => {
                    setRemoved(e.target.checked);
                    setPage(1);
                    setSelected(null);
                  }}
                />{' '}
                Show removed videos
              </label>
              <button
                className="secondary-button"
                disabled={busy || dirty}
                onClick={() => read.refresh()}
              >
                Check current status
              </button>
              <span>
                {data.total} video{data.total === 1 ? '' : 's'}
              </span>
            </div>
            <div className="video-layout">
              <div className="video-list" aria-label="Product video list">
                {!data.items.length && <p>No videos yet. Add a short product clip to begin.</p>}
                {data.items.map((v) => (
                  <button
                    className={'video-list-item ' + (selected?.id === v.id ? 'is-selected' : '')}
                    key={v.id}
                    disabled={busy || dirty}
                    aria-pressed={selected?.id === v.id}
                    onClick={() => choose(v)}
                  >
                    <strong>{v.description || 'Product video'}</strong>
                    <span>
                      {label(v.state)} / {label(v.reviewState)}
                    </span>
                    <small>
                      Attempt {v.attempts}/3 / Revision {v.version}
                    </small>
                    {v.errorCode && (
                      <small className="video-error">
                        {label(v.errorCode)}
                        {v.state === 'queued' ? ' / retry scheduled' : ''}
                      </small>
                    )}
                  </button>
                ))}
              </div>
              {selected && (
                <section className="video-details" aria-label="Selected video details">
                  <h3>
                    {label(selected.state)} / {label(selected.reviewState)}
                  </h3>
                  {selected.state === 'processing' && (
                    <p role="status">Preparing playback and poster in the background.</p>
                  )}
                  {selected.state === 'queued' && (
                    <p role="status">Waiting for the video worker. You can close this screen.</p>
                  )}
                  {selected.state === 'ready' && (
                    <>
                      <video
                        key={selected.id + ':' + selected.version}
                        controls
                        playsInline
                        preload="metadata"
                        aria-label={selected.description || 'Private product video'}
                        poster={'/api/v1/catalog/videos/' + selected.id + '/poster'}
                        src={'/api/v1/catalog/videos/' + selected.id + '/playback'}
                      />
                      <p>
                        {selected.width} x {selected.height} /{' '}
                        {Number(selected.durationSeconds).toFixed(1)} seconds /{' '}
                        {selected.hasAudio ? 'Audio present' : 'No audio'}
                      </p>
                    </>
                  )}
                  {canManage && selected.state !== 'removed' && (
                    <a
                      className="secondary-button"
                      href={'/api/v1/catalog/videos/' + selected.id + '/original'}
                      download
                    >
                      Download original
                    </a>
                  )}
                  <fieldset disabled={!canManage || busy || selected.state === 'removed'}>
                    <label>
                      Video description
                      <input
                        maxLength={240}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </label>
                    <label>
                      Associated variant
                      <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                        <option value="">Whole product</option>
                        {product.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.sku}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Video order
                      <input
                        type="number"
                        min={0}
                        max={99999}
                        value={position}
                        onChange={(e) => setPosition(Number(e.target.value))}
                      />
                    </label>
                  </fieldset>
                  {(canManage || canReview) && selected.state !== 'removed' && (
                    <>
                      <label>
                        Reason
                        <textarea
                          maxLength={500}
                          rows={2}
                          disabled={busy}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      {canReview && selected.state === 'ready' && (
                        <label className="video-rights">
                          <input
                            type="checkbox"
                            checked={rights}
                            disabled={busy}
                            onChange={(e) => setRights(e.target.checked)}
                          />{' '}
                          I verified this video is suitable for the brand and we have permission to
                          use it.
                        </label>
                      )}
                      <div className="video-actions">
                        {canManage && (
                          <button
                            className="secondary-button"
                            disabled={busy || !reason.trim()}
                            onClick={() => void action('metadata')}
                          >
                            Save video details
                          </button>
                        )}
                        {canReview && selected.state === 'ready' && (
                          <>
                            <button
                              className="primary-button"
                              disabled={
                                busy ||
                                !reason.trim() ||
                                !rights ||
                                !selected.description.trim() ||
                                metadataDirty
                              }
                              onClick={() => void action('approve')}
                            >
                              Approve private video
                            </button>
                            <button
                              className="secondary-button"
                              disabled={busy || !reason.trim()}
                              onClick={() => void action('revoke')}
                            >
                              Revoke approval
                            </button>
                          </>
                        )}
                        {canManage && ['queued', 'processing'].includes(selected.state) && (
                          <button
                            className="secondary-button"
                            disabled={busy || !reason.trim()}
                            onClick={() => void action('cancel')}
                          >
                            Cancel processing
                          </button>
                        )}
                        {canManage && ['failed', 'cancelled'].includes(selected.state) && (
                          <button
                            className="secondary-button"
                            disabled={busy || !reason.trim() || selected.attempts >= 3}
                            onClick={() => void action('retry')}
                          >
                            Retry processing
                          </button>
                        )}
                        {canManage && (
                          <button
                            className="secondary-button"
                            disabled={busy || !reason.trim()}
                            onClick={() => void action('remove')}
                          >
                            Remove from product
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void loadHistory()}
                  >
                    View video history
                  </button>
                  {history && (
                    <section aria-label="Video history">
                      <h4>Video history</h4>
                      {history.items.map((h) => (
                        <div key={h.version} className="video-history-row">
                          <strong>
                            Revision {h.version} / {label(h.action)} / {label(h.snapshot.state)}
                          </strong>
                          <p>{h.reason}</p>
                          <small>
                            {h.snapshot.performedBy === 'video_worker'
                              ? 'Background worker - initiated by '
                              : ''}
                            {h.actorName} /{' '}
                            {new Date(h.createdAt).toLocaleString('en-GB', {
                              timeZone: 'Asia/Dhaka',
                            })}{' '}
                            (Dhaka)
                          </small>
                        </div>
                      ))}
                      <button
                        disabled={history.page <= 1 || busy}
                        onClick={() => void loadHistory(history.page - 1)}
                      >
                        Previous history
                      </button>
                      <button
                        disabled={!history.hasMore || busy}
                        onClick={() => void loadHistory(history.page + 1)}
                      >
                        Next history
                      </button>
                    </section>
                  )}
                  {dirty && (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const current = data.items.find((v) => v.id === selected.id);
                        if (current) choose(current);
                        read.refresh();
                      }}
                    >
                      Discard edits and check current record
                    </button>
                  )}
                </section>
              )}
            </div>
            <div className="video-list-controls">
              <button disabled={busy || dirty || page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous videos
              </button>
              <span>Page {page}</span>
              <button
                disabled={busy || dirty || page * 20 >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next videos
              </button>
            </div>
          </>
        )}
        {confirmClose && (
          <div role="alert" className="video-close-check">
            <p>
              {busy
                ? 'Cancel this upload/action view and close? A queued job may continue in the background.'
                : 'Discard the current unsaved selection and close?'}
            </p>
            <button onClick={() => setConfirmClose(false)}>Keep editing</button>
            <button
              onClick={() => {
                controller.current?.abort();
                close();
              }}
            >
              Discard and close
            </button>
          </div>
        )}
        <div className="video-footer">
          <button className="secondary-button" onClick={requestClose}>
            Close videos
          </button>
        </div>
      </div>
    </Dialog>
  );
}
