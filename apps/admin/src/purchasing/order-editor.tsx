import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { costMinor, decimal, money } from './money';
import type {
  PurchaseOrder,
  PurchaseVariant,
  PurchaseLocation,
  Supplier,
  OrderInput,
} from './types';
type DraftLine = PurchaseVariant & { quantity: string; unitCost: string };
export function OrderEditor({
  api,
  initial,
  locations,
  onClose,
  onSaved,
}: {
  api: StaffApi;
  initial: PurchaseOrder | null;
  locations: PurchaseLocation[];
  onClose: () => void;
  onSaved: (order: PurchaseOrder) => void;
}) {
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(
      initial ? { id: initial.supplierId, name: initial.supplierName } : null,
    ),
    [supplierSearch, setSupplierSearch] = useState(''),
    [supplierResults, setSupplierResults] = useState<Supplier[]>([]);
  const [locationId, setLocation] = useState(initial?.locationId ?? locations[0]?.id ?? ''),
    [expectedOn, setDate] = useState(initial?.expectedOn ?? ''),
    [reference, setReference] = useState(initial?.reference ?? ''),
    [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(initial?.lines.map((l) => ({ ...l })) ?? []),
    [search, setSearch] = useState(''),
    [results, setResults] = useState<PurchaseVariant[]>([]),
    [searchError, setSearchError] = useState(''),
    [searching, setSearching] = useState(false);
  const [dirty, setDirty] = useState(false),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [error, setError] = useState('');
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [dirty]);
  useEffect(() => {
    if (supplier) return;
    let active = true;
    setSearchError('');
    const timer = window.setTimeout(() => {
      void api
        .suppliers({ search: supplierSearch.trim(), status: 'active', page: 1 })
        .then((p) => {
          if (active) setSupplierResults(p.items);
        })
        .catch((err) => {
          if (active)
            setSearchError(err instanceof Error ? err.message : 'Unable to find suppliers.');
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, supplier, supplierSearch]);
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
        .purchaseVariants(search.trim())
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
  }, [api, search]);
  const close = () => {
    if (!busy && (!dirty || window.confirm('Discard your unsaved purchase order?'))) onClose();
  };
  let total = 0n,
    valid = true;
  for (const l of lines) {
    const c = costMinor(l.unitCost);
    if (c === null || !/^[1-9]\d{0,8}$/.test(l.quantity)) {
      valid = false;
      break;
    }
    total += c * BigInt(l.quantity);
    if (total > 99999999999999n) valid = false;
  }
  const change = (index: number, patch: Partial<DraftLine>) => {
    setDirty(true);
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  async function save() {
    setBusy(true);
    setError('');
    try {
      const body: OrderInput = {
          supplierId: supplier!.id,
          locationId,
          expectedOn: expectedOn || null,
          reference,
          notes,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitCost: l.unitCost,
          })),
          ...(initial ? { expectedVersion: initial.version } : {}),
        },
        serialized = JSON.stringify(body);
      if (retry.current?.body !== serialized)
        retry.current = { body: serialized, key: crypto.randomUUID() };
      onSaved(await api.savePurchaseOrder(initial?.id ?? null, body, retry.current.key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save order.');
      setStale(err instanceof ApiError && err.code === 'STALE_PURCHASING_RECORD');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={initial ? 'Edit ' + initial.number : 'New purchase order'}
      subtitle="Prepare a draft. Issue it only after reviewing supplier, quantities and costs."
      onClose={close}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (!supplier || !locationId || !lines.length || !valid) {
            setError(
              'Choose a supplier and location, then add 1–25 SKUs with valid quantities and unit costs.',
            );
            return;
          }
          if (review) void save();
          else setReview(true);
        }}
      >
        <div className="dialog-body field-stack">
          <div className="inventory-guidance">
            A purchase order records what you plan to buy. Saving or issuing it does not receive
            stock, create a supplier bill or send a message to the supplier.
          </div>
          {!locations.length && (
            <p className="form-error" role="status">
              No active delivery locations are available. Ask your administrator to add a warehouse
              or store in Inventory first.
            </p>
          )}
          {review ? (
            <section className="inventory-review">
              <h3>Review purchase order draft</h3>
              <dl>
                <div>
                  <dt>Supplier</dt>
                  <dd>{supplier?.name}</dd>
                </div>
                <div>
                  <dt>Deliver to</dt>
                  <dd>{locations.find((l) => l.id === locationId)?.name}</dd>
                </div>
                {expectedOn && (
                  <div>
                    <dt>Expected on</dt>
                    <dd>{expectedOn}</dd>
                  </div>
                )}
                {reference && (
                  <div>
                    <dt>Reference</dt>
                    <dd>{reference}</dd>
                  </div>
                )}
              </dl>
              <ul>
                {lines.map((l) => (
                  <li key={l.variantId}>
                    <span>
                      {l.productName}
                      <small>
                        {l.sku} · {l.quantity} pcs × {money(decimal(costMinor(l.unitCost)!))}
                      </small>
                    </span>
                    <strong>{money(decimal(BigInt(l.quantity) * costMinor(l.unitCost)!))}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <>
              <section>
                <h3 className="purchase-field-title">Supplier</h3>
                {supplier ? (
                  <div className="purchase-selection">
                    <strong>{supplier.name}</strong>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setSupplier(null);
                        setDirty(true);
                      }}
                    >
                      Change supplier
                    </button>
                  </div>
                ) : (
                  <>
                    <label>
                      Find an active supplier
                      <input
                        value={supplierSearch}
                        onChange={(e) => setSupplierSearch(e.target.value)}
                        maxLength={100}
                        placeholder="Search name, code or phone"
                      />
                    </label>
                    <ul
                      className="inventory-results purchase-supplier-results"
                      aria-label="Matching suppliers"
                    >
                      {supplierResults.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSupplier({ id: s.id, name: s.name });
                              setDirty(true);
                            }}
                          >
                            <span>
                              <strong>{s.name}</strong>
                              <small>{s.code}</small>
                            </span>
                            <span>Select</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {!supplierResults.length && (
                      <p className="small muted">
                        No active suppliers found. Add a supplier from the Suppliers tab first.
                      </p>
                    )}
                  </>
                )}
              </section>
              <div className="editor-grid">
                <label>
                  Delivery location
                  <select
                    aria-label="Delivery location"
                    required
                    value={locationId}
                    onChange={(e) => {
                      setLocation(e.target.value);
                      setDirty(true);
                    }}
                  >
                    <option value="">Choose warehouse or store</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} · {l.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Expected delivery date (optional)
                  <input
                    type="date"
                    min="2000-01-01"
                    max="2199-12-31"
                    value={expectedOn}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
              </div>
              <label>
                Find a product or SKU
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  maxLength={100}
                  placeholder="Type at least 2 characters"
                  disabled={lines.length >= 25}
                />
              </label>
              {searching && (
                <p className="small muted" role="status">
                  Searching…
                </p>
              )}
              {!!results.length && (
                <ul className="inventory-results" aria-label="Matching SKUs">
                  {results.map((row) => (
                    <li key={row.variantId}>
                      <button
                        type="button"
                        disabled={
                          lines.length >= 25 || lines.some((l) => l.variantId === row.variantId)
                        }
                        onClick={() => {
                          setLines([...lines, { ...row, quantity: '1', unitCost: '' }]);
                          setDirty(true);
                          setSearch('');
                        }}
                      >
                        <span>
                          <strong>{row.productName}</strong>
                          <small>
                            {row.sku} · {Object.values(row.attributes).join(' / ')}
                          </small>
                        </span>
                        <span>Add SKU</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="purchase-draft-lines">
                {lines.map((l, i) => (
                  <div className="purchase-draft-line" key={l.variantId}>
                    <div>
                      <strong>{l.productName}</strong>
                      <small>{l.sku}</small>
                    </div>
                    <label>
                      Quantity (pcs)
                      <input
                        aria-label={'Quantity for ' + l.sku}
                        value={l.quantity}
                        required
                        inputMode="numeric"
                        pattern="[1-9][0-9]{0,8}"
                        maxLength={9}
                        onChange={(e) => change(i, { quantity: e.target.value })}
                      />
                    </label>
                    <label>
                      Unit cost (BDT)
                      <input
                        aria-label={'Unit cost for ' + l.sku}
                        required
                        inputMode="decimal"
                        maxLength={13}
                        value={l.unitCost}
                        placeholder="0.00"
                        onChange={(e) => change(i, { unitCost: e.target.value })}
                      />
                    </label>
                    <button
                      className="text-button"
                      type="button"
                      aria-label={'Remove ' + l.sku}
                      onClick={() => {
                        setLines(lines.filter((_, j) => j !== i));
                        setDirty(true);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <p className="small muted">
                {lines.length}/25 SKUs · Costs are purchase prices, separate from catalog selling
                prices.
              </p>
              <label>
                Reference (optional)
                <input
                  maxLength={100}
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                Internal notes
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </>
          )}
          <div className="purchase-total">
            <span>
              Goods subtotal (BDT)<small>Before tax, delivery and other charges</small>
            </span>
            <strong>{valid ? money(decimal(total)) : 'Check quantities and costs'}</strong>
          </div>
          {searchError && (
            <p className="form-error" role="alert">
              {searchError}
            </p>
          )}
          {error && (
            <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
              {error}
              {stale ? ' Close and reopen the latest order.' : ''}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => (review ? setReview(false) : close())}
          >
            {review ? 'Back to edit' : 'Cancel'}
          </button>
          <button className="primary-button" disabled={busy || stale}>
            {busy ? 'Saving…' : review ? 'Save draft' : 'Review draft'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
