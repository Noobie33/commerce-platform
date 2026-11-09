import { useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import type { SalesOrder } from './types';
import type { ReservationPage, ReservationInput } from './reservation-types';
import { problem } from './helpers';
const qty = (s: string) => BigInt(s).toLocaleString('en-BD');
const time = (s: string) => new Date(s).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
export function ReservationPanel({
  api,
  order,
  onChanged,
  onBusy,
  onDirty,
}: {
  api: StaffApi;
  order: SalesOrder;
  onChanged: () => Promise<void>;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
}) {
  const [data, setData] = useState<ReservationPage | null>(null),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [mode, setMode] = useState<'hold' | 'release' | null>(null),
    [reason, setReason] = useState(''),
    [minutes, setMinutes] = useState(30),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const reviewed = useRef<ReservationInput | null>(null);
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void api
      .salesReservations(order.id, page)
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e) => {
        if (live) setError(problem(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, order.id, order.version, page, revision]);
  useEffect(() => {
    onDirty(mode !== null && (reason.length > 0 || minutes !== 30 || review));
  }, [mode, reason, minutes, review, onDirty]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (review) {
      const h = reviewRef.current,
        d = h?.closest('dialog');
      if (h && d) {
        h.focus({ preventScroll: true });
        d.scrollTop +=
          h.getBoundingClientRect().top - d.getBoundingClientRect().top - d.clientHeight / 2;
      }
    }
  }, [review]);
  function cancel() {
    if (busy) return;
    setMode(null);
    setReason('');
    setReview(false);
    retry.current = null;
  }
  async function reload() {
    if (busy) return;
    if (mode && reason && !window.confirm('Discard unsaved stock hold details and refresh?'))
      return;
    cancel();
    setLoading(true);
    setError('');
    try {
      await onChanged();
      refresh((n) => n + 1);
    } catch (e) {
      setError(problem(e));
      setLoading(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!data || busy || !mode) return;
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }
    if (!review) {
      if (mode === 'release' && !data.current?.canRelease) {
        setError('This hold changed. Refresh stock before continuing.');
        return;
      }
      reviewed.current = {
        expectedVersion: order.version,
        expectedRevision: data.revision,
        reason,
        ...(mode === 'hold' ? { holdMinutes: minutes } : { reservationId: data.current!.id }),
      };
      setReview(true);
      return;
    }
    const body = reviewed.current;
    if (!body) {
      setError('Review the stock change again.');
      return;
    }
    const serialized = JSON.stringify({ mode, ...body });
    if (retry.current?.body !== serialized)
      retry.current = { body: serialized, key: crypto.randomUUID() };
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await api.postSalesReservation(order.id, mode, body, retry.current.key);
      setMode(null);
      setReason('');
      setReview(false);
      retry.current = null;
      setNotice(
        mode === 'hold'
          ? 'Stock hold recorded. No sale, payment or invoice was created.'
          : 'Stock hold released. Physical stock is unchanged.',
      );
      try {
        await onChanged();
      } catch {
        setError('The stock hold change was recorded. Refresh to load the latest order.');
      }
      refresh((n) => n + 1);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="reservation-panel">
      <div className="sales-section-title">
        <h3>Stock holds & availability</h3>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || loading}
          onClick={() => void reload()}
        >
          Refresh stock
        </button>
      </div>
      {notice && (
        <p className="sales-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading stock holds…</p>}
      {data && !loading && !data.visible && (
        <p>
          Inventory access at this order’s location is required to view stock availability and hold
          history.
        </p>
      )}
      {data?.visible && (
        <>
          <p className="sales-hint">
            Snapshot: {time(data.asOf)} (Dhaka). Availability is rechecked when a hold is saved.
            Holds manage stock only; they do not confirm a sale or record payment.
          </p>
          <div
            className="sales-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Sales stock availability"
          >
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Order quantity</th>
                  <th>On hand</th>
                  <th>Reserved</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.variantId}>
                    <td>{l.sku}</td>
                    <td>{qty(l.quantity)}</td>
                    <td>{qty(l.onHand)}</td>
                    <td>{qty(l.reserved)}</td>
                    <td>
                      <strong>{qty(l.available)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.current && (
            <div className="sales-warning">
              <strong>
                {data.current.status === 'active'
                  ? 'Stock is held for this order'
                  : 'This hold has expired'}
              </strong>
              <p>Expires: {time(data.current.expiresAt)} (Dhaka)</p>
              <p>{data.current.reason}</p>
              <p>
                {data.current.status === 'active'
                  ? 'Release this hold before editing or cancelling the draft.'
                  : 'Expired holds no longer reduce available stock.'}
              </p>
            </div>
          )}
          {!mode && (
            <div className="sales-actions reservation-actions">
              {order.status === 'draft' &&
                order.channel === 'retail' &&
                order.lines.every((l) => l.priceMode === 'catalog') &&
                data.canManage &&
                data.current?.status !== 'active' && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || loading}
                    onClick={() => {
                      setMode('hold');
                      setMinutes(30);
                      setReason('');
                      setError('');
                    }}
                  >
                    Reserve stock
                  </button>
                )}
              {data.current?.canRelease && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || loading}
                  onClick={() => {
                    setMode('release');
                    setReason('');
                    setError('');
                  }}
                >
                  Release hold
                </button>
              )}
            </div>
          )}
          {mode && (
            <form className="reservation-form" onSubmit={(e) => void submit(e)}>
              <fieldset className="sales-fields" disabled={busy || review}>
                <h4>
                  {mode === 'hold'
                    ? 'Reserve the full order quantity'
                    : 'Release this order’s stock hold'}
                </h4>
                {mode === 'hold' && (
                  <label>
                    Hold duration
                    <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                      <option value={30}>30 minutes</option>
                      <option value={120}>2 hours</option>
                      <option value={1440}>24 hours</option>
                    </select>
                  </label>
                )}
                <label>
                  Reason *
                  <textarea
                    required
                    maxLength={500}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </fieldset>
              {review && (
                <section className="sales-warning" ref={reviewRef} tabIndex={-1}>
                  <h4>Review stock {mode === 'hold' ? 'hold' : 'release'}</h4>
                  <p>
                    {order.number} · {order.locationName}
                  </p>
                  <p>
                    {mode === 'hold'
                      ? `Reserve the full quantity of ${data.lines.length} ${data.lines.length === 1 ? 'variant' : 'variants'} for ${minutes} minutes. No physical stock will move.`
                      : 'Release the recorded hold; physical quantities stay unchanged.'}
                  </p>
                  <p>Reason: {reason}</p>
                </section>
              )}
              <div className="sales-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={cancel}>
                  Cancel hold change
                </button>
                {review && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setReview(false)}
                  >
                    Back
                  </button>
                )}
                <button className="primary-button" disabled={busy || loading}>
                  {busy
                    ? 'Recording…'
                    : review
                      ? mode === 'hold'
                        ? 'Confirm stock hold'
                        : 'Confirm release'
                      : 'Review stock change'}
                </button>
              </div>
            </form>
          )}
          <details className="reservation-history">
            <summary>Hold history ({data.total})</summary>
            {data.items.map((h) => (
              <article key={h.id}>
                <strong>
                  {h.status === 'active'
                    ? 'Active'
                    : h.status === 'expired'
                      ? 'Expired'
                      : 'Released'}{' '}
                  · {h.locationName}
                </strong>
                <p>{h.reason}</p>
                <small>
                  {h.actorName} · {time(h.createdAt)} (Dhaka) · order v{h.orderVersion}
                </small>
                <p>Expires {time(h.expiresAt)} (Dhaka)</p>
                {h.closedAt && (
                  <p>
                    {h.closeKind === 'expiry' ? 'Expiry recorded' : 'Released'}: {h.closeReason}
                    <br />
                    {h.closedBy} · {time(h.closedAt)} (Dhaka)
                  </p>
                )}
                <p>{h.lines.map((l) => l.sku + ': ' + qty(l.quantity)).join(' · ')}</p>
              </article>
            ))}
            {data.total > 20 && (
              <div className="sales-pagination">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || loading || mode !== null || page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous holds
                </button>
                <span>Page {page}</span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || loading || mode !== null || page * 20 >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next holds
                </button>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
