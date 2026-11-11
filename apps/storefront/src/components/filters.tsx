'use client';
import { useRef, useState } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import type { Browse, Category } from '../lib/catalog-contract';
import { Icon } from './icon';
const groups = {
  color: 'Colour',
  materialGroup: 'Fabric',
  size: 'Size',
  fit: 'Cut / Fit',
  occasion: 'Occasion',
};
const swatches: Record<string, string> = {
  black: '#151515',
  white: '#fff',
  blue: '#3f64a2',
  red: '#aa3030',
  green: '#4f7056',
  charcoal: '#42474a',
  grey: '#929292',
  gray: '#929292',
  brown: '#795b43',
  beige: '#c9b891',
  pink: '#e4a6b2',
  purple: '#856a9f',
  yellow: '#e7cd66',
  orange: '#d98648',
  olive: '#7a805b',
  navy: '#263a5c',
  cream: '#efe7cf',
};
export function Filters({
  view,
  categories,
  values,
}: {
  view: Browse;
  categories: Category[];
  values: Record<string, string>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [active, setActive] = useState('color'),
    [visit, setVisit] = useState(0);
  function open(group = 'color') {
    setActive(group);
    setVisit((v) => v + 1);
    dialog.current?.showModal();
  }
  function disclosure(key: string, label: string, children: React.ReactNode) {
    return (
      <details className="filter-group" open={active === key}>
        <summary
          onClick={(e) => {
            e.preventDefault();
            setActive(active === key ? '' : key);
          }}
        >
          {label}
          <span aria-hidden="true">{active === key ? '−' : '+'}</span>
        </summary>
        {children}
      </details>
    );
  }
  return (
    <div className="collection-toolbar">
      <div className="filter-triggers">
        <span className="filter-prefix">Filters:</span>
        <button className="filter-all" aria-label="All filters" onClick={() => open('category')}>
          <Icon name="filter" />
          <span className="mobile-filter-label">Filters</span>
        </button>
        {(['color', 'materialGroup', 'price', 'size', 'fit'] as const).map((k) => (
          <button key={k} className="filter-shortcut" onClick={() => open(k)}>
            {k === 'price' ? 'Price' : groups[k]}
          </button>
        ))}
      </div>
      <Form action="/shop" className="collection-sort">
        {Object.entries(values)
          .filter(([k]) => !['sort', 'page'].includes(k))
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <label>
          Sort By :
          <select
            aria-label="Sort by"
            name="sort"
            defaultValue={values.sort ?? 'name'}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            <option value="name">Name, A to Z</option>
            <option value="price_desc">Price (High to Low)</option>
            <option value="price_asc">Price (Low to High)</option>
          </select>
        </label>
        <noscript>
          <button type="submit">Sort</button>
        </noscript>
      </Form>
      <dialog
        ref={dialog}
        className="filter-drawer"
        aria-labelledby="filter-drawer-title"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <header className="filter-drawer-heading">
          <h2 id="filter-drawer-title">FILTER</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close filters"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <Form
          action="/shop"
          className="filter-drawer-form"
          key={visit}
          onSubmit={() => dialog.current?.close()}
        >
          {values.q && <input type="hidden" name="q" value={values.q} />}
          <input type="hidden" name="sort" value={values.sort ?? 'name'} />
          <div className="filter-drawer-body">
            {disclosure(
              'category',
              'Category',
              <label className="filter-category">
                <span className="sr-only">Category</span>
                <select name="category" defaultValue={values.category ?? ''}>
                  <option value="">All categories</option>
                  {values.category && !categories.some((c) => c.slug === values.category) && (
                    <option value={values.category}>Current category</option>
                  )}
                  {categories.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.parentSlug
                        ? (categories.find((p) => p.slug === c.parentSlug)?.name ?? '') + ' / '
                        : ''}
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>,
            )}
            {(Object.keys(groups) as (keyof typeof groups)[]).map((k) => (
              <div key={k}>
                {disclosure(
                  k,
                  groups[k],
                  <fieldset className="filter-options">
                    <legend className="sr-only">{groups[k]}</legend>
                    <label className="filter-option">
                      <input type="radio" name={k} value="" defaultChecked={!values[k]} />
                      <span>
                        All{' '}
                        {
                          {
                            color: 'colours',
                            materialGroup: 'fabrics',
                            size: 'sizes',
                            fit: 'fits',
                            occasion: 'occasions',
                          }[k]
                        }
                      </span>
                    </label>
                    {values[k] && !view.facets[k].items.some((x) => x.value === values[k]) && (
                      <label className="filter-option">
                        <input type="radio" name={k} value={values[k]} defaultChecked />
                        <span>{values[k]}</span>
                      </label>
                    )}
                    {view.facets[k].items.map((x) => (
                      <label key={x.value} className="filter-option">
                        <input
                          type="radio"
                          name={k}
                          value={x.value}
                          defaultChecked={values[k] === x.value}
                        />
                        {k === 'color' && (
                          <span
                            aria-hidden="true"
                            className="colour-swatch"
                            style={{
                              background: Object.hasOwn(swatches, x.value.toLowerCase())
                                ? swatches[x.value.toLowerCase()]
                                : '#ddd',
                            }}
                          />
                        )}
                        <span className={k === 'size' ? 'size-label' : 'option-label'}>
                          {x.value.replaceAll('_', ' ')}
                        </span>
                        <small>{x.count}</small>
                      </label>
                    ))}
                  </fieldset>,
                )}
              </div>
            ))}
            {disclosure(
              'price',
              'Price',
              <fieldset className="price-fields">
                <legend>Price in taka</legend>
                <label>
                  <span className="sr-only">Minimum price</span>
                  <input
                    name="minPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Min"
                    defaultValue={values.minPrice ?? ''}
                  />
                </label>
                <span aria-hidden="true">&mdash;</span>
                <label>
                  <span className="sr-only">Maximum price</span>
                  <input
                    name="maxPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Max"
                    defaultValue={values.maxPrice ?? ''}
                  />
                </label>
              </fieldset>,
            )}
          </div>
          <footer className="filter-drawer-footer">
            <button type="submit" className="button button-dark">
              Apply filters
            </button>
            <Link href="/shop" prefetch={false} onClick={() => dialog.current?.close()}>
              Clear all
            </Link>
          </footer>
        </Form>
      </dialog>
    </div>
  );
}
