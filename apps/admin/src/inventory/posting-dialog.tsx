import { useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type {
  HistoryRow,
  InventoryLocation,
  PostingKind,
  StockRow,
  ReversalPreview,
} from './types';
export const labels: Record<string, string> = {
  opening: 'Opening stock',
  receipt: 'Stock receipt',
  adjustment: 'Stock adjustment',
  transfer: 'Stock transfer',
  reversal: 'Reversal',
};
type Selected = StockRow & { amount: string; decrease: boolean };
export function PostingDialog({
  api,
  kind,
  location,
  locations,
  reversing,
  reversalPreview,
  onClose,
  onSaved,
}: {
  api: StaffApi;
  kind: PostingKind;
  location: InventoryLocation;
  locations: InventoryLocation[];
  reversing?: HistoryRow | undefined;
  reversalPreview: ReversalPreview[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<Selected[]>([]),
    [search, setSearch] = useState(''),
    [results, setResults] = useState<StockRow[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState('');
  const [destination, setDestination] = useState(''),
    [reason, setReason] = useState(''),
    [reference, setReference] = useState(''),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null),
    retry = useRef<{ body: string; key: string } | null>(null);
  const cannotReverse =
    !!reversing && reversalPreview.some((l) => BigInt(l.quantityAfter) < BigInt(l.reserved));
  const dirty = !!(lines.length || reason || reference || destination);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    let active = true;
    setResults([]);
    setSearchError('');
    if (search.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api
        .inventoryVariants(location.id, search.trim())
        .then((rows) => {
          if (active) setResults(rows);
        })
        .catch((err) => {
          if (active) setSearchError(err instanceof Error ? err.message : 'Unable to search SKUs.');
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, location.id, search]);
  const close = () => {
    if (!busy && (!dirty || window.confirm('Discard this unsaved stock action?'))) onClose();
  };
  const payload = () =>
    reversing
      ? { reason: reason.trim(), reference: reference.trim() }
      : {
          kind,
          locationId: location.id,
          destinationId: kind === 'transfer' ? destination : null,
          reason: reason.trim(),
          reference: reference.trim(),
          lines: lines.map((l) => ({
            variantId: l.variantId,
            quantity: (kind === 'adjustment' && l.decrease ? '-' : '') + l.amount,
          })),
        };
  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = payload(),
        serialized = JSON.stringify(body);
      if (retry.current?.body !== serialized)
        retry.current = { body: serialized, key: crypto.randomUUID() };
      if (reversing)
        await api.reverseStock(
          reversing.id,
          body as { reason: string; reference: string },
          retry.current.key,
        );
      else await api.postStock(body as Parameters<StaffApi['postStock']>[0], retry.current.key);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post stock.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={reversing ? 'Reverse stock posting' : labels[kind]!}
      subtitle={location.name + ' · ' + location.code}
      onClose={close}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (!reversing && !lines.length) {
            setError('Add at least one SKU.');
            return;
          }
          if (!review) setReview(true);
          else void save();
        }}
      >
        <div className="dialog-body field-stack">
          <div className="inventory-guidance">
            {reversing
              ? 'This creates an opposite entry for every line of the original posting, including both locations of a transfer. The original history stays unchanged.'
              : kind === 'opening'
                ? 'Use once per SKU and location to record your starting physical count. After the first movement, use a receipt or adjustment.'
                : kind === 'transfer'
                  ? 'Moves physical stock between two locations. Both sides are saved together.'
                  : kind === 'adjustment'
                    ? 'Record a physical count correction, damage or loss. Include a clear reason.'
                    : 'Record a direct stock receipt. For purchase order deliveries, receive through Purchasing to keep quantities and supplier invoices linked.'}
          </div>
          {review ? (
            <section className="inventory-review" aria-label="Review stock action">
              <h3>Review before posting</h3>
              <dl>
                <div>
                  <dt>Action</dt>
                  <dd>{reversing ? 'Reverse ' + labels[reversing.kind] : labels[kind]}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{location.name}</dd>
                </div>
                {!reversing && kind === 'transfer' && (
                  <div>
                    <dt>Destination</dt>
                    <dd>{locations.find((l) => l.id === destination)?.name}</dd>
                  </div>
                )}
                <div>
                  <dt>Reason</dt>
                  <dd>{reason}</dd>
                </div>
                {reference && (
                  <div>
                    <dt>Reference</dt>
                    <dd>{reference}</dd>
                  </div>
                )}
              </dl>
              <ul>
                {reversing
                  ? reversalPreview.map((l) => (
                      <li key={(l.locationId ?? '') + l.variantId}>
                        <span>{l.sku}</span>
                        <strong>
                          {l.delta.startsWith('-') ? '−' : '+'}
                          {l.delta.replace('-', '')} pcs · {l.locationName}
                        </strong>
                      </li>
                    ))
                  : lines.map((l) => (
                      <li key={l.variantId}>
                        <span>
                          {l.sku}
                          <small>{l.productName}</small>
                        </span>
                        <strong>
                          {kind === 'adjustment'
                            ? l.decrease
                              ? '−'
                              : '+'
                            : kind === 'transfer'
                              ? 'Move '
                              : '+'}
                          {l.amount} pcs
                        </strong>
                      </li>
                    ))}
              </ul>
              <p className="muted small">
                Stock is checked again when you confirm. Posted entries are corrected with a
                reversal.
              </p>
            </section>
          ) : (
            <>
              {kind === 'transfer' && !reversing && (
                <label>
                  Destination location
                  <select
                    required
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="">Choose destination</option>
                    {locations
                      .filter((l) => l.id !== location.id && l.canTransfer)
                      .map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.name} · {l.code}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {!reversing && (
                <>
                  <label>
                    Find a product or SKU
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      maxLength={100}
                      placeholder="Type at least 2 characters"
                      autoComplete="off"
                      disabled={lines.length >= 25}
                    />
                  </label>
                  <div aria-live="polite" className="small muted">
                    {searching
                      ? 'Searching…'
                      : searchError ||
                        (search.trim().length >= 2 && !results.length ? 'No matching SKUs.' : '')}
                  </div>
                  {!!results.length && (
                    <ul className="inventory-results" aria-label="Matching SKUs">
                      {results.map((row) => {
                        const chosen = lines.some((l) => l.variantId === row.variantId),
                          inactive = !row.isActive || row.productStatus === 'archived';
                        return (
                          <li key={row.variantId}>
                            <button
                              type="button"
                              disabled={
                                chosen ||
                                lines.length >= 25 ||
                                ((kind === 'opening' || kind === 'receipt') && inactive)
                              }
                              onClick={() => {
                                setLines([...lines, { ...row, amount: '1', decrease: false }]);
                                setSearch('');
                              }}
                            >
                              <span>
                                <strong>{row.productName}</strong>
                                <small>
                                  {row.sku} · {Object.values(row.attributes).join(' / ')}
                                  {inactive ? ' · Inactive' : ''}
                                </small>
                              </span>
                              <span>{chosen ? 'Added' : 'Add SKU'}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="inventory-lines">
                    {lines.map((row, index) => (
                      <div className="inventory-line" key={row.variantId}>
                        <div>
                          <strong>{row.productName}</strong>
                          <small>
                            {row.sku} · On hand {row.quantity} pcs
                          </small>
                        </div>
                        {kind === 'adjustment' && (
                          <label>
                            Direction
                            <select
                              value={row.decrease ? 'decrease' : 'increase'}
                              onChange={(e) =>
                                setLines(
                                  lines.map((l, i) =>
                                    i === index
                                      ? { ...l, decrease: e.target.value === 'decrease' }
                                      : l,
                                  ),
                                )
                              }
                            >
                              <option value="increase">Increase</option>
                              <option value="decrease">Decrease</option>
                            </select>
                          </label>
                        )}
                        <label>
                          Quantity (pcs)
                          <input
                            aria-label={'Quantity for ' + row.sku}
                            inputMode="numeric"
                            required
                            pattern="[1-9][0-9]{0,8}"
                            maxLength={9}
                            value={row.amount}
                            onChange={(e) =>
                              setLines(
                                lines.map((l, i) =>
                                  i === index ? { ...l, amount: e.target.value } : l,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          className="text-button"
                          type="button"
                          aria-label={'Remove ' + row.sku}
                          onClick={() => setLines(lines.filter((_, i) => i !== index))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="small muted">{lines.length}/25 SKUs · Whole pieces only</p>
                </>
              )}
              <label>
                Reason
                <textarea
                  required
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this stock changing?"
                />
              </label>
              <label>
                Reference <span className="muted">(optional)</span>
                <input
                  maxLength={100}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Delivery note or internal reference"
                />
              </label>
            </>
          )}
          {cannotReverse && (
            <p className="form-error" role="alert">
              There is not enough unreserved stock to reverse every line. Release the relevant holds
              or restore physical stock, then refresh history.
            </p>
          )}
          {error && (
            <p className="form-error" ref={errorRef} tabIndex={-1} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => (review ? setReview(false) : close())}
          >
            {review ? 'Back to edit' : 'Cancel'}
          </button>
          <button className="primary-button" disabled={busy || (review && cannotReverse)}>
            {busy ? 'Posting…' : review ? 'Confirm & post' : 'Review stock action'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
