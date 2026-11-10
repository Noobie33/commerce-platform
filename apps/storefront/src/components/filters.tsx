'use client';
import { useRef } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import type { Browse, Category } from '../lib/catalog-contract';
import { Icon } from './icon';
const labels = {
  size: 'Size',
  color: 'Colour',
  fit: 'Fit',
  materialGroup: 'Material',
  occasion: 'Occasion',
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
  const dialog = useRef<HTMLDialogElement>(null);
  function form(mobile = false) {
    return (
      <Form
        action="/shop"
        className="filter-form"
        onSubmit={() => {
          if (mobile) dialog.current?.close();
        }}
      >
        {values.q && <input type="hidden" name="q" value={values.q} />}
        <label>
          Category
          <select name="category" defaultValue={values.category ?? ''}>
            <option value="">All categories</option>
            {values.category && !categories.some((c) => c.slug === values.category) && (
              <option value={values.category}>Current category</option>
            )}
            {categories.map((c) => (
              <option value={c.slug} key={c.id}>
                {c.parentSlug
                  ? (categories.find((p) => p.slug === c.parentSlug)?.name ?? '') + ' / '
                  : ''}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
          <label key={k}>
            {labels[k]}
            <select name={k} defaultValue={values[k] ?? ''}>
              <option value="">All {labels[k].toLowerCase()}s</option>
              {values[k] && !view.facets[k].items.some((x) => x.value === values[k]) && (
                <option value={values[k]}>{values[k].replaceAll('_', ' ')}</option>
              )}
              {view.facets[k].items.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.value.replaceAll('_', ' ')} ({x.count})
                </option>
              ))}
            </select>
          </label>
        ))}
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
        </fieldset>
        <label>
          Sort by
          <select name="sort" defaultValue={values.sort ?? 'name'}>
            <option value="name">Name, A to Z</option>
            <option value="price_asc">Price, low to high</option>
            <option value="price_desc">Price, high to low</option>
          </select>
        </label>
        <button type="submit" className="button button-dark">
          Apply filters
        </button>
        <Link
          href="/shop"
          prefetch={false}
          className="filter-clear"
          onClick={() => dialog.current?.close()}
        >
          Clear all
        </Link>
      </Form>
    );
  }
  return (
    <>
      <aside className="desktop-filters" aria-label="Product filters">
        <h2>Refine your edit</h2>
        {form()}
      </aside>
      <button
        className="button button-outline mobile-filter-trigger"
        onClick={() => dialog.current?.showModal()}
      >
        Filter &amp; sort <Icon name="menu" />
      </button>
      <dialog className="filter-modal" ref={dialog}>
        <div className="filter-modal-heading">
          <h2>Filter &amp; sort</h2>
          <button
            className="icon-button"
            aria-label="Close filters"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        {form(true)}
      </dialog>
    </>
  );
}
