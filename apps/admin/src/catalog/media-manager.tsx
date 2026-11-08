import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { Product, MediaResult } from './types';
const MAX_BYTES = 5 * 1024 * 1024;
export function MediaManager({
  api,
  initial,
  onClose,
  onChanged,
  onReload,
}: {
  api: StaffApi;
  initial: Product;
  onClose: () => void;
  onChanged: (result: MediaResult) => void;
  onReload: (product: Product) => void;
}) {
  const [product, setProduct] = useState(initial),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [stale, setStale] = useState(false);
  const uploadRetry = useRef<{ file: File; version: number; key: string } | null>(null),
    actionRetry = useRef<{ operation: string; id: string; version: number; key: string } | null>(
      null,
    ),
    input = useRef<HTMLInputElement>(null),
    errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);
  useEffect(() => {
    let current = true;
    if (!file) {
      setPreview('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (current && typeof reader.result === 'string') setPreview(reader.result);
    };
    reader.readAsDataURL(file);
    return () => {
      current = false;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [file]);
  function changed(result: MediaResult) {
    setProduct((p) => ({ ...p, version: result.version, photos: result.photos }));
    onChanged(result);
    setStale(false);
  }
  function failed(error: unknown) {
    setError(error instanceof Error ? error.message : 'Unable to change photos.');
    setStale(error instanceof ApiError && error.code === 'STALE_PRODUCT');
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (uploadRetry.current?.file !== file || uploadRetry.current.version !== product.version)
        uploadRetry.current = { file, version: product.version, key: crypto.randomUUID() };
      changed(await api.uploadPhoto(product.id, product.version, file, uploadRetry.current.key));
      setFile(null);
      uploadRetry.current = null;
      if (input.current) input.current.value = '';
      setNotice('Photo uploaded.');
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  async function action(operation: 'primary' | 'remove', photoId: string) {
    if (operation === 'remove' && !window.confirm('Remove this photo from the product?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const prior = actionRetry.current;
      if (
        !prior ||
        prior.operation !== operation ||
        prior.id !== photoId ||
        prior.version !== product.version
      )
        actionRetry.current = {
          operation,
          id: photoId,
          version: product.version,
          key: crypto.randomUUID(),
        };
      changed(
        await api.changePhoto(
          product.id,
          photoId,
          operation,
          product.version,
          actionRetry.current!.key,
        ),
      );
      actionRetry.current = null;
      setNotice(
        operation === 'primary' ? 'Primary photo updated.' : 'Photo removed from the product.',
      );
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError('');
    try {
      const latest = await api.product(product.id);
      setProduct(latest);
      onReload(latest);
      setStale(false);
      uploadRetry.current = null;
      actionRetry.current = null;
      setNotice('Latest product loaded. Review the photos before continuing.');
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (!busy && (!file || window.confirm('Discard the selected photo without uploading it?')))
      onClose();
  }
  const photos = product.photos ?? [];
  return (
    <Dialog title="Product photos" subtitle={product.name} onClose={close} wide>
      <div className="dialog-body media-manager">
        <div className="section-heading">
          <div>
            <h3>Show your product clearly</h3>
            <p>JPEG, PNG or WebP · up to 5 MB and 16 megapixels per photo.</p>
          </div>
          <span className="count-pill">{photos.length} / 8 photos</span>
        </div>
        <div className="media-upload-zone">
          <div>
            <label htmlFor="product-photo-file">Select a product photo</label>
            <p>The first photo becomes primary. Photos save separately from product details.</p>
            <input
              ref={input}
              id="product-photo-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || stale || photos.length >= 8}
              onChange={(event) => {
                setError('');
                setNotice('');
                const chosen = event.target.files?.[0];
                if (!chosen) {
                  setFile(null);
                  return;
                }
                if (
                  !['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type) ||
                  chosen.size < 1 ||
                  chosen.size > MAX_BYTES
                ) {
                  setError('Choose a JPEG, PNG or WebP file up to 5 MB.');
                  event.target.value = '';
                  setFile(null);
                  return;
                }
                setFile(chosen);
                uploadRetry.current = null;
              }}
            />
          </div>
          {file && (
            <div className="media-pending">
              {preview && <img src={preview} alt="Selected photo preview" />}
              <span>{file.name}</span>
              <button
                type="button"
                className="primary-button"
                disabled={busy || stale || photos.length >= 8}
                onClick={() => void upload()}
              >
                {busy ? 'Uploading…' : 'Upload photo'}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  if (input.current) input.current.value = '';
                }}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
        {error && (
          <div ref={errorRef} tabIndex={-1} className="form-error editor-error" role="alert">
            {error}
            {stale && (
              <button className="text-button" disabled={busy} onClick={() => void reload()}>
                Reload latest product
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className="catalog-notice" role="status">
            {notice}
          </p>
        )}
        <div className="media-photo-grid">
          {photos.map((photo, index) => (
            <section
              className="media-photo-card"
              key={photo.id}
              aria-label={'Photo ' + (index + 1)}
            >
              <img src={photo.thumbnailUrl} alt={product.name + ' photo ' + (index + 1)} />
              <div>
                <span>{photo.isPrimary ? 'Primary photo' : 'Additional photo'}</span>
                <small>
                  {photo.width} × {photo.height}
                </small>
                <div className="media-photo-actions">
                  {!photo.isPrimary && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy || stale}
                      onClick={() => void action('primary', photo.id)}
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy || stale}
                    onClick={() => void action('remove', photo.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
        {!photos.length && (
          <p className="media-empty">No photos yet. Upload your first product photo above.</p>
        )}
      </div>
      <footer className="dialog-footer">
        <span className="catalog-note">
          {busy
            ? 'Please wait for the current upload to finish.'
            : 'Photo changes are saved immediately.'}
        </span>
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
