import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type {
  SalesOrder,
  SalesLine,
  SalesLocation,
  SalesCustomer,
  SalesVariant,
  SalesInput,
} from './types';
import { problem, minor, decimal, money } from './helpers';
export function SalesEditor({
  api,
  initial,
  locations,
  close,
  saved,
}: {
  api: StaffApi;
  initial: SalesOrder | null;
  locations: SalesLocation[];
  close: () => void;
  saved: (r: { id: string }) => void;
}) {
  const [customer, setCustomer] = useState<SalesCustomer | null>(
      initial ? initial.customerSnapshot : null,
    ),
    [customerSearch, setCustomerSearch] = useState(''),
    [customers, setCustomers] = useState<SalesCustomer[]>([]),
    [customerError, setCustomerError] = useState(''),
    [findingCustomer, setFindingCustomer] = useState(false),
    [locationId, setLocation] = useState(initial?.locationId ?? locations[0]?.id ?? ''),
    [fulfillOn, setDate] = useState(initial?.fulfillOn ?? ''),
    [reference, setReference] = useState(initial?.reference ?? ''),
    [notes, setNotes] = useState(initial?.notes ?? ''),
    [lines, setLines] = useState<SalesLine[]>(initial?.lines ?? []),
    [search, setSearch] = useState(''),
    [variants, setVariants] = useState<SalesVariant[]>([]),
    [variantError, setVariantError] = useState(''),
    [findingVariant, setFindingVariant] = useState(false),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    reviewRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const listener = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  useEffect(() => {
    let live = true;
    setCustomers([]);
    setCustomerError('');
    if (customer || customerSearch.trim().length < 2) {
      setFindingCustomer(false);
      return;
    }
    setFindingCustomer(true);
    const t = setTimeout(() => {
      void api
        .salesCustomers(customerSearch.trim())
        .then((r) => {
          if (live) setCustomers(r);
        })
        .catch((e) => {
          if (live) setCustomerError(problem(e));
        })
        .finally(() => {
          if (live) setFindingCustomer(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, customer, customerSearch]);
  useEffect(() => {
    let live = true;
    setVariants([]);
    setVariantError('');
    if (search.trim().length < 2) {
      setFindingVariant(false);
      return;
    }
    setFindingVariant(true);
    const t = setTimeout(() => {
      void api
        .salesVariants(search.trim())
        .then((r) => {
          if (live) setVariants(r);
        })
        .catch((e) => {
          if (live) setVariantError(problem(e));
        })
        .finally(() => {
          if (live) setFindingVariant(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, search]);
  useEffect(() => {
    if (review) {
      const heading = reviewRef.current,
        dialog = heading?.closest('dialog');
      if (heading && dialog) {
        heading.focus({ preventScroll: true });
        dialog.scrollTop +=
          heading.getBoundingClientRect().top -
          dialog.getBoundingClientRect().top -
          dialog.clientHeight / 2;
      }
    }
  }, [review]);
  function changed() {
    setDirty(true);
    setError('');
  }
  function dismiss() {
    if (!busy && (!dirty || window.confirm('Discard unsaved sales draft changes?'))) close();
  }
  function updateLine(id: string, change: Partial<SalesLine>) {
    changed();
    setLines((old) => old.map((l) => (l.variantId === id ? { ...l, ...change } : l)));
  }
  const compatible = customer?.segment === 'retail';
  let total = 0n,
    valid = lines.length > 0;
  for (const l of lines) {
    const price = minor(l.unitPrice);
    if (price === null || !/^[1-9]\d{0,8}$/.test(l.quantity)) {
      valid = false;
      continue;
    }
    total += BigInt(l.quantity) * price;
  }
  if (total > 99999999999999n) valid = false;
  async function refreshPrices() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const current = await Promise.all(lines.map((l) => api.salesVariant(l.variantId)));
      setLines((old) =>
        old.map((l) => {
          const v = current.find((v) => v.variantId === l.variantId)!;
          return {
            ...l,
            ...v,
            unitPrice: l.priceMode === 'catalog' ? v.catalogPrice : l.unitPrice,
          };
        }),
      );
      changed();
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || stale) return;
    if (
      !customer ||
      !compatible ||
      !locationId ||
      !valid ||
      lines.some((l) => l.priceMode !== 'catalog')
    ) {
      setError('Choose a retail customer, active location and valid catalog-priced lines.');
      return;
    }
    if (!review) {
      setReview(true);
      return;
    }
    const body: SalesInput = {
      customerId: customer.id,
      customerVersion: customer.version,
      locationId,
      channel: 'retail',
      fulfillOn: fulfillOn || null,
      reference,
      notes,
      priceReason: '',
      lines: lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        priceMode: 'catalog',
      })),
      ...(initial ? { expectedVersion: initial.version } : {}),
    };
    const serial = JSON.stringify(body);
    if (retry.current?.body !== serial) retry.current = { body: serial, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      saved(await api.saveSalesOrder(initial?.id ?? null, body, retry.current.key));
    } catch (e) {
      setError(problem(e));
      if (
        e instanceof ApiError &&
        ['SALES_STALE', 'SALES_STATE', 'SALES_RESERVED'].includes(e.code ?? '')
      )
        setStale(true);
      else if (e instanceof ApiError && e.status >= 400 && e.status < 500) setReview(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={initial ? 'Edit sales draft' : 'New sales draft'}
      subtitle={initial?.number ?? 'Prepare an order at the current retail catalog prices.'}
      onClose={dismiss}
      wide
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="sales-dialog-body">
          {error && (
            <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
              {error}
            </p>
          )}
          <p className="sales-scope">
            Draft only. Saving reserves no stock and creates no customer balance.
          </p>
          <fieldset disabled={busy || review || stale} className="sales-fields">
            <section>
              <h3>Customer & fulfillment</h3>
              {customer ? (
                <div className="sales-selected">
                  <div>
                    <strong>{customer.name}</strong>
                    <small>
                      {customer.code} · {customer.segment}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setCustomer(null);
                      setCustomerSearch('');
                      changed();
                    }}
                  >
                    Change customer
                  </button>
                </div>
              ) : (
                <>
                  <label>
                    Find customer
                    <input
                      maxLength={140}
                      value={customerSearch}
                      placeholder="Type a name or customer code"
                      onChange={(e) => setCustomerSearch(e.target.value)}
                    />
                  </label>
                  {findingCustomer && <p role="status">Finding customers…</p>}
                  {customerError && (
                    <p className="form-error" role="alert">
                      {customerError}
                    </p>
                  )}
                  <div className="sales-results" aria-label="Matching customers">
                    {customers.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => {
                          setCustomer(c);
                          setCustomerSearch('');
                          changed();
                        }}
                      >
                        <strong>{c.name}</strong>
                        <small>
                          {c.code} · {c.segment}
                        </small>
                      </button>
                    ))}
                  </div>
                  {customerSearch.trim().length >= 2 &&
                    !findingCustomer &&
                    !customerError &&
                    !customers.length && (
                      <p>No active customer matches. Add the customer in Customers first.</p>
                    )}
                </>
              )}
              <div className="sales-grid">
                <label>
                  Fulfillment location
                  <select
                    required
                    value={locationId}
                    onChange={(e) => {
                      setLocation(e.target.value);
                      changed();
                    }}
                  >
                    <option value="">Choose a location</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} · {l.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Requested fulfillment date
                  <input
                    type="date"
                    min="2000-01-01"
                    max="2100-12-31"
                    value={fulfillOn}
                    onChange={(e) => {
                      setDate(e.target.value);
                      changed();
                    }}
                  />
                </label>
                <label>
                  Customer reference
                  <input
                    maxLength={100}
                    value={reference}
                    onChange={(e) => {
                      setReference(e.target.value);
                      changed();
                    }}
                  />
                </label>
              </div>
              {customer && !compatible && (
                <p className="sales-warning" role="status">
                  This archived customer profile cannot be used for a new retail draft.
                </p>
              )}
            </section>
            <section>
              <div className="sales-section-title">
                <h3>Order lines</h3>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!lines.length}
                  onClick={() => void refreshPrices()}
                >
                  Refresh catalog prices
                </button>
              </div>
              <label>
                Find product variants
                <input
                  maxLength={140}
                  value={search}
                  placeholder="Search product name or SKU"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {findingVariant && <p role="status">Finding variants…</p>}
              {variantError && (
                <p className="form-error" role="alert">
                  {variantError}
                </p>
              )}
              <div className="sales-results" aria-label="Matching product variants">
                {variants.map((v) => (
                  <button
                    type="button"
                    key={v.variantId}
                    disabled={lines.length >= 30 || lines.some((l) => l.variantId === v.variantId)}
                    onClick={() => {
                      setLines((old) => [
                        ...old,
                        {
                          ...v,
                          quantity: '1',
                          unitPrice: v.catalogPrice,
                          priceMode: 'catalog',
                          lineTotal: v.catalogPrice,
                        },
                      ]);
                      setSearch('');
                      changed();
                    }}
                  >
                    <strong>{v.productName}</strong>
                    <small>
                      {v.sku} · {Object.values(v.attributes).join(' / ')} · {money(v.catalogPrice)}
                    </small>
                  </button>
                ))}
              </div>
              {search.trim().length >= 2 &&
                !findingVariant &&
                !variantError &&
                !variants.length && <p>No active product variant matches.</p>}
              <div className="sales-lines">
                {lines.map((l) => (
                  <article className="sales-line" key={l.variantId}>
                    <div className="sales-section-title">
                      <div>
                        <strong>{l.productName}</strong>
                        <small>
                          {l.sku} · {Object.values(l.attributes).join(' / ')}
                        </small>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        aria-label={'Remove ' + l.sku}
                        onClick={() => {
                          setLines((old) => old.filter((v) => v.variantId !== l.variantId));
                          changed();
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="sales-grid">
                      <label>
                        Quantity · {l.sku}
                        <input
                          required
                          inputMode="numeric"
                          pattern="[1-9][0-9]{0,8}"
                          value={l.quantity}
                          onChange={(e) => updateLine(l.variantId, { quantity: e.target.value })}
                        />
                      </label>
                      <label>
                        Unit price (BDT) · {l.sku}
                        <input
                          required
                          inputMode="decimal"
                          pattern="(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?"
                          readOnly
                          value={l.unitPrice}
                          onChange={(e) => updateLine(l.variantId, { unitPrice: e.target.value })}
                        />
                        <small>Catalog: {money(l.catalogPrice)}</small>
                      </label>
                      <div className="sales-line-total">
                        <span>Line total</span>
                        <strong>
                          {minor(l.unitPrice) !== null && /^[1-9]\d{0,8}$/.test(l.quantity)
                            ? money(decimal(minor(l.unitPrice)! * BigInt(l.quantity)))
                            : 'Check inputs'}
                        </strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {!lines.length && (
                <p className="sales-empty">Choose at least one active product variant.</p>
              )}
            </section>
            <label>
              Internal order notes
              <textarea
                rows={3}
                maxLength={1000}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  changed();
                }}
              />
            </label>
          </fieldset>
          <div className="sales-total">
            <span>Draft goods total</span>
            <strong>{valid ? money(decimal(total)) : 'Check order lines'}</strong>
          </div>
          <p className="sales-hint">
            Goods total only. Tax, delivery, discounts, payments and confirmation will be handled in
            later sales workflows.
          </p>
          {review && (
            <section className="sales-warning">
              <h3 ref={reviewRef} tabIndex={-1}>
                Review sales draft
              </h3>
              <p>
                {customer?.name} · Retail · {locations.find((l) => l.id === locationId)?.name}
              </p>
              <p>
                {lines.length} {lines.length === 1 ? 'variant' : 'variants'} ·{' '}
                {money(decimal(total))}
              </p>
              <p>Saving this draft will not reserve or deduct inventory or create an invoice.</p>
            </section>
          )}
        </div>
        <footer className="dialog-footer sales-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={dismiss}>
            Cancel
          </button>
          {review && !stale && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Back
            </button>
          )}
          <button className="primary-button" disabled={busy || stale}>
            {busy ? 'Saving…' : review ? 'Save draft' : 'Review draft'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
