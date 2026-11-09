import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { Product } from './types';
import type { ContentInput, ContentSnapshot, ContentView } from './content-types';
import './content.css';
const contentFieldOrder = [
  'material',
  'fit',
  'neckline',
  'sleeves',
  'finish',
  'garmentLengthCm',
  'widthCm',
  'heightCm',
  'depthCm',
  'weightGrams',
  'care',
];
function orderedEntries<T>(fields: Record<string, T>): [string, T][] {
  return Object.entries(fields).sort(([a], [b]) => {
    const x = contentFieldOrder.indexOf(a),
      y = contentFieldOrder.indexOf(b);
    return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b);
  });
}
type Draft = {
  profile: string;
  slug: string;
  description: string;
  specifications: Record<string, string>;
};
const stateLabel = (value: string) => value.replaceAll('_', ' ');
const money = (value: string) => {
  const n = BigInt(value);
  return 'BDT ' + (n / 100n).toLocaleString('en-BD') + '.' + (n % 100n).toString().padStart(2, '0');
};
export function ProductContent({
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
  const [view, setView] = useState<ContentView | null>(null),
    [form, setForm] = useState<Draft | null>(null),
    [original, setOriginal] = useState(''),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [preview, setPreview] = useState(false),
    [historical, setHistorical] = useState<ContentSnapshot | null>(null);
  const retry = useRef<{ body: string; key: string } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = !!form && JSON.stringify(form) !== original;
  const load = useCallback(async () => {
    const value = await api.productContent(product.id, page);
    const draft: Draft = value.record
      ? {
          profile: value.record.profile,
          slug: value.record.slug,
          description: value.record.description,
          specifications: value.record.specifications,
        }
      : { profile: 'clothing-v1', slug: '', description: '', specifications: {} };
    setView(value);
    setForm(draft);
    setOriginal(JSON.stringify(draft));
    setHistorical(null);
  }, [api, product.id, page]);
  useEffect(() => {
    let live = true;
    setError('');
    void api
      .productContent(product.id, page)
      .then((value) => {
        if (!live) return;
        const draft: Draft = value.record
          ? {
              profile: value.record.profile,
              slug: value.record.slug,
              description: value.record.description,
              specifications: value.record.specifications,
            }
          : { profile: 'clothing-v1', slug: '', description: '', specifications: {} };
        setView(value);
        setForm(draft);
        setOriginal(JSON.stringify(draft));
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : 'Unable to load content.');
      });
    return () => {
      live = false;
    };
  }, [api, product.id, page]);
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
  function dismiss() {
    if (!busy && (!dirty || window.confirm('Discard unsaved product content?'))) close();
  }
  function update(change: Partial<Draft>) {
    setForm((old) => (old ? { ...old, ...change } : old));
    setError('');
    setNotice('');
    setHistorical(null);
  }
  async function act(action: ContentInput['action']) {
    if (!view || !form || busy) return;
    if (action !== 'save' && dirty) {
      setError('Save or discard your changes before a review action.');
      return;
    }
    if (['approve', 'request_changes', 'withdraw'].includes(action) && !reason.trim()) {
      setError('Add a reason for this review decision.');
      return;
    }
    const input: ContentInput = {
      action,
      expectedVersion: view.record?.version ?? 0,
      expectedProductVersion: view.productVersion,
      ...(action === 'save' ? form : {}),
      ...(['approve', 'request_changes', 'withdraw'].includes(action) ? { reason } : {}),
    };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    let recorded = false;
    try {
      await api.saveProductContent(product.id, input, retry.current.key);
      recorded = true;
      await load();
      setReason('');
      setNotice(
        action === 'save'
          ? 'Content draft saved.'
          : action === 'submit'
            ? 'Submitted for review.'
            : action === 'approve'
              ? 'Content approved. Storefront publishing remains a separate step.'
              : action === 'withdraw'
                ? 'Returned to draft.'
                : 'Changes requested.',
      );
    } catch (e) {
      setError(
        recorded
          ? 'The content action was recorded. Reload to see its latest state.'
          : e instanceof Error
            ? e.message
            : 'Unable to save product content.',
      );
    } finally {
      setBusy(false);
    }
  }
  const profile = view?.profiles.find((p) => p.code === form?.profile),
    reviewing = view?.record?.state === 'in_review',
    editable = canManage && !reviewing;
  const currentPreview = view && form ? { ...view.preview, ...form } : null;
  const snapshot =
    historical ??
    (!dirty &&
    view?.record?.submittedSnapshot &&
    ['in_review', 'approved'].includes(view.record.state)
      ? view.record.submittedSnapshot
      : currentPreview);
  return (
    <Dialog
      title="Product content & review"
      subtitle={product.name + ' / ' + product.styleCode}
      onClose={dismiss}
      wide
    >
      <div className="product-content-body">
        <p className="content-boundary">
          Prepare customer-facing details here. Approval keeps a reviewed version; it does not put
          the product online yet.
        </p>
        {error && (
          <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error}{' '}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                if (!dirty || window.confirm('Discard changes and reload?'))
                  void load().catch((e) => setError(e.message));
              }}
            >
              Reload content
            </button>
          </p>
        )}
        {notice && (
          <p role="status" className="content-notice">
            {notice}
          </p>
        )}
        {!view || !form ? (
          <p role="status">Loading product content…</p>
        ) : (
          <>
            <div className="content-status">
              <strong>{view.record ? stateLabel(view.record.state) : 'Not prepared'}</strong>
              <span>
                Content version {view.record?.version ?? 0} / Catalog revision {view.productVersion}
              </span>
            </div>
            {view.record &&
              ['in_review', 'approved'].includes(view.record.state) &&
              !view.current && (
                <p className="content-warning" role="status">
                  Catalog details, prices or photos changed after submission. This version needs a
                  fresh review before it can be used online.
                </p>
              )}
            <div className="content-tabs">
              <button
                type="button"
                aria-pressed={!preview}
                className="secondary-button"
                onClick={() => {
                  setPreview(false);
                  setHistorical(null);
                }}
              >
                {editable ? 'Edit details' : 'View details'}
              </button>
              <button
                type="button"
                aria-pressed={preview}
                className="secondary-button"
                onClick={() => {
                  setPreview(true);
                  setHistorical(null);
                }}
              >
                Staff preview
              </button>
            </div>
            {preview && snapshot ? (
              <section className="content-preview" aria-label="Staff product content preview">
                <p className="eyebrow">
                  {historical
                    ? 'HISTORICAL REVIEW COPY'
                    : dirty
                      ? 'UNSAVED STAFF PREVIEW'
                      : 'STAFF PREVIEW'}
                </p>
                <h3>{snapshot.name}</h3>
                <p>
                  {snapshot.styleCode} / {snapshot.category?.name ?? 'No category'}
                </p>
                {(() => {
                  const photo = product.photos.find((p) =>
                    snapshot.photos.some((s) => s.id === p.id && s.primary),
                  );
                  return photo ? <img src={photo.thumbnailUrl} alt={snapshot.name} /> : null;
                })()}
                <p className="content-copy">
                  {snapshot.description || 'No customer-facing description yet.'}
                </p>
                <dl>
                  {orderedEntries(snapshot.specifications ?? {})
                    .filter(([, v]) => v)
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>
                          {view.profiles.find((p) => p.code === snapshot.profile)?.fields[key]
                            ?.label ?? key}
                        </dt>
                        <dd>{stateLabel(value)}</dd>
                      </div>
                    ))}
                </dl>
                <ul>
                  {snapshot.variants.map((v) => (
                    <li key={v.id}>
                      {v.sku} / {Object.values(v.attributes).join(' / ')} / {money(v.priceMinor)}
                    </li>
                  ))}
                </ul>
                <p className="catalog-note">
                  These are reference product measurements. Size-specific garment and body
                  measurements belong in a separate size guide.
                </p>
              </section>
            ) : (
              <fieldset disabled={busy || !editable} className="content-fields">
                <label>
                  Product type
                  <select
                    value={form.profile}
                    onChange={(e) => {
                      if (
                        !Object.values(form.specifications).some(Boolean) ||
                        window.confirm(
                          'Changing product type clears the current specification fields. Continue?',
                        )
                      )
                        update({ profile: e.target.value, specifications: {} });
                    }}
                  >
                    {view.profiles.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Product URL name
                  <input
                    maxLength={120}
                    placeholder="cotton-oversized-shirt"
                    value={form.slug}
                    onChange={(e) => update({ slug: e.target.value })}
                  />
                  <small>Lowercase letters, numbers and hyphens. Required before review.</small>
                </label>
                <label className="content-full">
                  Customer-facing description
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={form.description}
                    onChange={(e) => update({ description: e.target.value })}
                  />
                </label>
                {orderedEntries(profile?.fields ?? {}).map(([key, field]) => (
                  <label key={key} className={key === 'care' ? 'content-full' : ''}>
                    {field.label}
                    {field.required ? ' *' : ''}
                    {field.kind === 'choice' ? (
                      <select
                        value={form.specifications[key] ?? ''}
                        onChange={(e) =>
                          update({
                            specifications: { ...form.specifications, [key]: e.target.value },
                          })
                        }
                      >
                        <option value="">Choose {field.label.toLowerCase()}</option>
                        {field.options?.map((option) => (
                          <option key={option} value={option}>
                            {stateLabel(option)}
                          </option>
                        ))}
                      </select>
                    ) : field.max && field.max > 200 ? (
                      <textarea
                        rows={3}
                        maxLength={field.max}
                        value={form.specifications[key] ?? ''}
                        onChange={(e) =>
                          update({
                            specifications: { ...form.specifications, [key]: e.target.value },
                          })
                        }
                      />
                    ) : (
                      <input
                        inputMode={field.kind === 'decimal' ? 'decimal' : 'text'}
                        maxLength={field.max ?? 40}
                        placeholder={field.kind === 'decimal' ? 'e.g. 72.50' : undefined}
                        value={form.specifications[key] ?? ''}
                        onChange={(e) =>
                          update({
                            specifications: { ...form.specifications, [key]: e.target.value },
                          })
                        }
                      />
                    )}
                  </label>
                ))}
              </fieldset>
            )}
            <section className="content-readiness">
              <h3>Review checklist</h3>
              {dirty ? (
                <p>Save this draft to refresh its checks.</p>
              ) : view.issues.length ? (
                <ul>
                  {view.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>Required content, category, active SKU and primary photo are present.</p>
              )}
            </section>
            {reviewing && (canManage || canReview) && (
              <label className="content-reason">
                Review decision / withdrawal reason
                <textarea
                  rows={2}
                  maxLength={500}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
                <small>
                  A separate reviewer approves staff submissions. Owner self-approval is explicitly
                  recorded.
                </small>
              </label>
            )}
            <section className="content-history">
              <h3>Content history</h3>
              {view.history.items.length ? (
                view.history.items.map((event) => (
                  <article key={event.version}>
                    <strong>
                      Version {event.version} / {stateLabel(event.action)} /{' '}
                      {stateLabel(event.state)}
                    </strong>
                    <p>{event.reason || 'Content revision recorded'}</p>
                    <small>
                      {event.actorName} /{' '}
                      {new Date(event.createdAt).toLocaleString('en-GB', {
                        timeZone: 'Asia/Dhaka',
                      })}{' '}
                      (Dhaka)
                    </small>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setHistorical(event.snapshot);
                        setPreview(true);
                      }}
                    >
                      Preview version {event.version}
                    </button>
                  </article>
                ))
              ) : (
                <p>No content revisions yet.</p>
              )}
              <div className="content-history-pages">
                <button
                  disabled={busy || dirty || page === 1}
                  onClick={() => {
                    setHistorical(null);
                    setPage((n) => n - 1);
                  }}
                >
                  Previous history
                </button>
                <span>
                  Page {page} of {Math.max(1, Math.ceil(view.history.total / 20))}
                </span>
                <button
                  disabled={busy || dirty || page * 20 >= view.history.total}
                  onClick={() => {
                    setHistorical(null);
                    setPage((n) => n + 1);
                  }}
                >
                  Next history
                </button>
              </div>
            </section>
          </>
        )}
      </div>
      <footer className="dialog-footer content-actions">
        <button className="secondary-button" disabled={busy} onClick={dismiss}>
          Close
        </button>
        {view && form && editable && (
          <button
            className="secondary-button"
            disabled={
              busy ||
              (!dirty && !!view.record && !(view.record.state === 'approved' && !view.current))
            }
            onClick={() => void act('save')}
          >
            {busy ? 'Saving…' : 'Save content draft'}
          </button>
        )}
        {view?.record && canManage && !reviewing && view.record.state !== 'approved' && (
          <button
            className="primary-button"
            disabled={busy || dirty || !!view.issues.length}
            onClick={() => void act('submit')}
          >
            Submit for review
          </button>
        )}
        {reviewing && canManage && (
          <button
            className="secondary-button"
            disabled={busy || dirty}
            onClick={() => void act('withdraw')}
          >
            Withdraw submission
          </button>
        )}
        {reviewing && canReview && (
          <>
            <button
              className="secondary-button"
              disabled={busy || dirty}
              onClick={() => void act('request_changes')}
            >
              Request changes
            </button>
            <button
              className="primary-button"
              disabled={busy || dirty || !view?.current || !!view.issues.length}
              onClick={() => void act('approve')}
            >
              Approve content
            </button>
          </>
        )}
      </footer>
    </Dialog>
  );
}
