import { useEffect, useRef, useState } from 'react';
import type { StaffApi } from '../api';
import type { GalleryReviewInput, GalleryReviewView } from './gallery-release.types';
export function GalleryReview({
  api,
  id,
  view,
  blocked,
  canReview,
  onSaved,
  onEditing,
  onPending,
}: {
  api: StaffApi;
  id: string;
  view: GalleryReviewView;
  blocked: boolean;
  canReview: boolean;
  onSaved: () => Promise<void>;
  onEditing: (dirty: boolean) => void;
  onPending: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState(''),
    [rights, setRights] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const retry = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    setRights(false);
    onEditing(!!reason);
  }, [view.currentBasis, view.version]);
  async function act(action: 'approve' | 'revoke') {
    if (busy || blocked || !reason.trim()) return;
    const input: GalleryReviewInput = {
        action,
        expectedVersion: view.version,
        reason: reason.trim(),
        ...(action === 'approve'
          ? {
              expectedDraftVersion: view.currentDraftVersion,
              expectedBasis: view.currentBasis,
              rightsConfirmed: true,
            }
          : {}),
      },
      body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    onPending(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      await api.reviewGallery(id, input, retry.current.key);
      saved = true;
      setReason('');
      setRights(false);
      onEditing(false);
      retry.current = null;
      await onSaved();
      setNotice(
        action === 'approve'
          ? 'Public gallery approval recorded. Publish the product separately to release this order.'
          : 'Gallery approval revoked. Published mixed media is now unavailable.',
      );
    } catch (e) {
      setError(
        saved
          ? 'Decision saved. Reopen this gallery to see its current state.'
          : e instanceof Error
            ? e.message
            : 'Unable to record the review.',
      );
    } finally {
      setBusy(false);
      onPending(false);
    }
  }
  return (
    <section className="gallery-public-review">
      <h3>Website gallery approval</h3>
      <p>
        <strong>
          {view.state.replaceAll('_', ' ')} / review {view.version}
        </strong>
      </p>
      <p>
        Only an explicitly reviewed order can join a new published release. Editing the draft does
        not replace an already approved order.
      </p>
      {view.state === 'approved' && (
        <p>
          {view.eligible
            ? 'The reviewed media is still current.'
            : 'The reviewed media changed; public mixed-media access is blocked.'}{' '}
          {view.matchesDraft
            ? 'The saved draft matches this approval.'
            : 'The draft differs from the reviewed order.'}
        </p>
      )}
      {!view.currentReady && (
        <p>
          Before approval: primary photo first, descriptive labels, approved photos/videos and
          silent video. Captions/audio policy is required before clips with sound can be published.
        </p>
      )}
      {view.approvedItems.length > 0 && (
        <details>
          <summary>Previously reviewed order</summary>
          <ol>
            {view.approvedItems.map((x) => (
              <li key={x.kind + x.id}>
                {x.label} / {x.kind}
              </li>
            ))}
          </ol>
        </details>
      )}
      {blocked && <p>Save or discard unsaved gallery edits before recording a review.</p>}
      {canReview && (
        <>
          <label>
            Reason for gallery review
            <textarea
              value={reason}
              maxLength={500}
              disabled={busy || blocked}
              onChange={(e) => {
                setReason(e.target.value);
                onEditing(!!e.target.value || rights);
              }}
            />
          </label>
          <label className="gallery-rights">
            <input
              type="checkbox"
              checked={rights}
              disabled={busy || blocked}
              onChange={(e) => {
                setRights(e.target.checked);
                onEditing(!!reason || e.target.checked);
              }}
            />
            I reviewed this exact saved order, own or have permission to publish these assets, and
            confirm their descriptions and suitability for customers.
          </label>
          <div className="gallery-review-actions">
            <button
              className="primary-button"
              disabled={busy || blocked || !view.currentReady || !reason.trim() || !rights}
              onClick={() => void act('approve')}
            >
              Approve gallery for website
            </button>
            <button
              className="secondary-button"
              disabled={busy || blocked || view.state !== 'approved' || !reason.trim()}
              onClick={() => void act('revoke')}
            >
              Revoke gallery approval
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Gallery review history (latest 20)</summary>
        {view.history.map((x) => (
          <article key={x.version}>
            <strong>
              {x.action} / review {x.version}
            </strong>
            <p>{x.reason}</p>
            <small>
              {x.actorName} /{' '}
              {new Date(x.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} (Dhaka)
            </small>
          </article>
        ))}
      </details>
    </section>
  );
}
