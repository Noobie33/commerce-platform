import { useEffect, useRef, useState } from 'react';
import { ApiError, StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { CategoryDialog } from './category-dialog';
import { categoryName, combinations, newVariant } from './helpers';
import type { Category, Product, ProductPayload, ProductStatus, VariantDraft } from './types';
export function ProductEditor({
  api,
  initial,
  categories,
  onCategories,
  onClose,
  onSaved,
  onReload,
}: {
  api: StaffApi;
  initial: Product | null;
  categories: Category[];
  onCategories: (categories: Category[]) => void;
  onClose: () => void;
  onSaved: (p: Product) => void;
  onReload: (p: Product) => void;
}) {
  const [styleCode, setStyle] = useState(initial?.styleCode ?? ''),
    [name, setName] = useState(initial?.name ?? ''),
    [description, setDescription] = useState(initial?.description ?? ''),
    [categoryId, setCategory] = useState(initial?.categoryId ?? ''),
    [status, setStatus] = useState<ProductStatus>(initial?.status ?? 'draft');
  const [variants, setVariants] = useState<VariantDraft[]>(() =>
    initial
      ? initial.variants.map((v) => ({ ...v, key: v.id, barcode: v.barcode ?? '' }))
      : [newVariant()],
  );
  const [sizes, setSizes] = useState(''),
    [colours, setColours] = useState(''),
    [defaultPrice, setDefaultPrice] = useState(''),
    [categoryOpen, setCategoryOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false),
    [dirty, setDirty] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [dirty]);
  function close() {
    if (!busy && (!dirty || window.confirm('Discard your unsaved product changes?'))) onClose();
  }
  function changeVariant(key: string, patch: Partial<VariantDraft>) {
    setDirty(true);
    setVariants((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload: ProductPayload = {
        styleCode: styleCode.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim(),
        categoryId: categoryId || null,
        status,
        currency: 'BDT',
        ...(initial ? { expectedVersion: initial.version } : {}),
        variants: variants.map(({ id, sku, attributes, barcode, price, isActive }) => ({
          ...(id ? { id } : {}),
          sku: sku.trim().toUpperCase(),
          attributes,
          barcode: barcode.trim() || null,
          price: price.trim(),
          isActive,
        })),
      };
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).length > 16000)
        throw new Error(
          'This product exceeds the editor size limit. Shorten descriptions or use fewer new variants.',
        );
      if (!retry.current || retry.current.body !== body)
        retry.current = { body, key: crypto.randomUUID() };
      onSaved(await api.saveProduct(initial?.id ?? null, payload, retry.current.key));
    } catch (error) {
      setStale(error instanceof ApiError && error.code === 'STALE_PRODUCT');
      setError(error instanceof Error ? error.message : 'Unable to save product.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog
        title={initial ? 'Edit product' : 'Create product'}
        subtitle={
          initial
            ? 'Keep identifiers consistent while updating your collection.'
            : 'One style. Every size, colour and sellable option.'
        }
        onClose={close}
        wide
      >
        <form onSubmit={(event) => void save(event)} onChange={() => setDirty(true)}>
          <fieldset disabled={busy} className="editor-fieldset">
            <div className="dialog-body">
              <div className="editor-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">01 / THE PRODUCT</span>
                    <h3>Collection essentials</h3>
                  </div>
                  <span className="subtle-label">* Required</span>
                </div>
                <div className="editor-grid">
                  <label className="field-span">
                    Product name *
                    <input
                      required
                      maxLength={140}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Essential cotton tee"
                    />
                  </label>
                  <label>
                    Style code *
                    <input
                      required
                      readOnly={!!initial}
                      maxLength={40}
                      pattern="[A-Za-z0-9][A-Za-z0-9._\x2D]{0,39}"
                      value={styleCode}
                      onChange={(e) => setStyle(e.target.value.toUpperCase())}
                      placeholder="e.g. CT-001"
                    />
                    <small>Permanent reference for this product.</small>
                  </label>
                  <label>
                    Product status
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as ProductStatus)}
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </select>
                    <small>Archiving keeps product history.</small>
                  </label>
                  <label className="field-span">
                    Category
                    <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">Uncategorised</option>
                      {categories.map((c) => (
                        <option value={c.id} key={c.id}>
                          {categoryName(c.id, categories)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setCategoryOpen(true)}
                  >
                    + New category
                  </button>
                  <label className="field-span">
                    Description
                    <textarea
                      maxLength={2000}
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Fabric, fit and details for your team."
                    />
                  </label>
                </div>
              </div>
              <div className="editor-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">02 / VARIANTS & PRICING</span>
                    <h3>Make every option count</h3>
                    <p>Use a unique SKU per option. Retail prices are in BDT.</p>
                  </div>
                  <span className="count-pill">{variants.length} / 50 SKUs</span>
                </div>
                <details className="variant-generator">
                  <summary>Generate size & colour combinations</summary>
                  <div className="generator-grid">
                    <label>
                      Sizes, separated by commas
                      <input
                        value={sizes}
                        onChange={(e) => setSizes(e.target.value)}
                        placeholder="S, M, L, XL"
                      />
                    </label>
                    <label>
                      Colours, separated by commas
                      <input
                        value={colours}
                        onChange={(e) => setColours(e.target.value)}
                        placeholder="Black, Ivory"
                      />
                    </label>
                    <label>
                      Default retail price
                      <input
                        inputMode="decimal"
                        value={defaultPrice}
                        onChange={(e) => setDefaultPrice(e.target.value)}
                        placeholder="1250.00"
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        try {
                          const rows = combinations(styleCode, sizes, colours, defaultPrice);
                          const untouched =
                            variants.length === 1 &&
                            !variants[0]!.id &&
                            !variants[0]!.sku &&
                            !variants[0]!.price &&
                            !variants[0]!.barcode &&
                            !Object.keys(variants[0]!.attributes).length;
                          const next = untouched ? rows : [...variants, ...rows];
                          if (next.length > 50)
                            throw new Error('Keep this product within 50 variants.');
                          setVariants(next);
                          setDirty(true);
                          setError('');
                        } catch (error) {
                          setError(
                            error instanceof Error ? error.message : 'Unable to generate variants.',
                          );
                        }
                      }}
                    >
                      Generate variants
                    </button>
                  </div>
                  <p className="catalog-note">
                    Review generated SKUs before saving. Existing rows stay intact.
                  </p>
                </details>
                <div className="variant-list">
                  {variants.map((v, index) => (
                    <section
                      className="variant-card"
                      key={v.key}
                      aria-label={'Variant ' + (index + 1)}
                    >
                      <header>
                        <strong>Variant {String(index + 1).padStart(2, '0')}</strong>
                        {v.id ? (
                          <span className="subtle-label">Saved SKU</span>
                        ) : (
                          <button
                            className="text-button"
                            type="button"
                            disabled={variants.length === 1}
                            onClick={() => {
                              setVariants((rows) => rows.filter((row) => row.key !== v.key));
                              setDirty(true);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </header>
                      <div className="variant-fields">
                        <label>
                          SKU *
                          <input
                            required
                            minLength={3}
                            maxLength={64}
                            pattern="[A-Za-z0-9][A-Za-z0-9._\x2D]{2,63}"
                            readOnly={!!v.id}
                            value={v.sku}
                            onChange={(e) =>
                              changeVariant(v.key, { sku: e.target.value.toUpperCase() })
                            }
                          />
                        </label>
                        <label>
                          Retail price (BDT) *
                          <input
                            required
                            inputMode="decimal"
                            pattern="[0-9]{1,10}([.][0-9]{1,2})?"
                            value={v.price}
                            onChange={(e) => changeVariant(v.key, { price: e.target.value })}
                            placeholder="0.00"
                          />
                        </label>
                        <label>
                          Barcode
                          <input
                            maxLength={64}
                            value={v.barcode}
                            onChange={(e) => changeVariant(v.key, { barcode: e.target.value })}
                            placeholder="Optional"
                          />
                        </label>
                        {v.id ? (
                          <div className="saved-options">
                            <span>Options</span>
                            <strong>
                              {Object.entries(v.attributes)
                                .map(([k, value]) => k + ': ' + value)
                                .join(' · ') || 'Standard'}
                            </strong>
                          </div>
                        ) : (
                          <>
                            <label>
                              Size
                              <input
                                maxLength={60}
                                value={v.attributes.size ?? ''}
                                onChange={(e) =>
                                  changeVariant(v.key, {
                                    attributes: Object.fromEntries(
                                      Object.entries({
                                        ...v.attributes,
                                        size: e.target.value,
                                      }).filter(([, value]) => value !== ''),
                                    ),
                                  })
                                }
                                onBlur={() => {
                                  if (!v.attributes.size?.trim()) {
                                    const attrs = { ...v.attributes };
                                    delete attrs.size;
                                    changeVariant(v.key, { attributes: attrs });
                                  }
                                }}
                              />
                            </label>
                            <label>
                              Colour
                              <input
                                maxLength={60}
                                value={v.attributes.colour ?? ''}
                                onChange={(e) => {
                                  const attrs = { ...v.attributes };
                                  if (e.target.value) attrs.colour = e.target.value;
                                  else delete attrs.colour;
                                  changeVariant(v.key, { attributes: attrs });
                                }}
                              />
                            </label>
                          </>
                        )}
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={v.isActive}
                            onChange={(e) => changeVariant(v.key, { isActive: e.target.checked })}
                          />
                          Active variant
                        </label>
                      </div>
                    </section>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={variants.length >= 50}
                  onClick={() => {
                    setVariants((rows) => [...rows, newVariant()]);
                    setDirty(true);
                  }}
                >
                  + Add variant
                </button>
                {initial && (
                  <p className="catalog-note">
                    Saved SKUs and options remain permanent. Deactivate an old variant and add a
                    replacement when options change.
                  </p>
                )}
              </div>
              {error && (
                <div className="form-error editor-error" role="alert" ref={errorRef} tabIndex={-1}>
                  {error}
                  {stale && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={async () => {
                        if (!window.confirm('Discard this edit and open the latest saved product?'))
                          return;
                        setBusy(true);
                        try {
                          onReload(await api.product(initial!.id));
                        } catch (error) {
                          setError(error instanceof Error ? error.message : 'Unable to reload.');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Open latest saved product
                    </button>
                  )}
                </div>
              )}
            </div>
          </fieldset>
          <footer className="dialog-footer">
            <span className="catalog-note">Changes save together.</span>
            <button type="button" className="secondary-button" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button className="primary-button" disabled={busy || stale}>
              {busy ? 'Saving…' : initial ? 'Save changes' : 'Create product'}
            </button>
          </footer>
        </form>
      </Dialog>
      {categoryOpen && (
        <CategoryDialog
          api={api}
          categories={categories}
          onClose={() => setCategoryOpen(false)}
          onCreated={(category) => {
            onCategories([...categories, category]);
            setCategory(category.id);
            setCategoryOpen(false);
            setDirty(true);
          }}
        />
      )}
    </>
  );
}
