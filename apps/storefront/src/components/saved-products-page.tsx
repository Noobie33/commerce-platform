'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSavedProducts } from './saved-products';
import { parseSavedCards } from '../lib/catalog-contract';
import type { Card } from '../lib/catalog-contract';
import { ProductCard } from './product-card';
export function SavedProductsPage() {
  const { ids, ready, pending, setSaved } = useSavedProducts(),
    key = ids.join(','),
    [view, setView] = useState<{
      state: 'loading' | 'ready' | 'error';
      items: Card[];
      key: string;
    }>({ state: 'loading', items: [], key: '' }),
    controller = useRef<AbortController | null>(null),
    serial = useRef(0),
    last = useRef(0);
  const load = useCallback(async () => {
    controller.current?.abort();
    const id = ++serial.current,
      requestIds = key ? key.split(',') : [];
    last.current = Date.now();
    if (!requestIds.length) {
      setView({ state: 'ready', items: [], key });
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setView({ state: 'loading', items: [], key });
    try {
      const r = await fetch('/saved-products/resolve', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ productIds: requestIds }),
      });
      if (!r.ok) throw Error('Saved products unavailable');
      const items = parseSavedCards(await r.json(), requestIds, true);
      if (id === serial.current && !abort.signal.aborted) setView({ state: 'ready', items, key });
    } catch {
      if (id === serial.current && !abort.signal.aborted)
        setView({ state: 'error', items: [], key });
    }
  }, [key]);
  useEffect(() => {
    if (ready) void load();
    return () => {
      serial.current++;
      controller.current?.abort();
    };
  }, [ready, load]);
  useEffect(() => {
    const refresh = () => {
      if (
        ready &&
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        Date.now() - last.current > 1000
      )
        void load();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [ready, load]);
  const cards = new Map(view.items.map((p) => [p.productId, p]));
  return (
    <main id="main-content" className="wishlist-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/" prefetch={false}>
          Home
        </Link>
        <span>/</span>
        <span>Wishlist</span>
      </nav>
      <h1>MY WISHLIST</h1>
      <p className="wishlist-explanation">
        Saved on this browser. Account sign-in and syncing between devices are not available yet.
      </p>
      {ready && (
        <p className="wishlist-total">
          {ids.length} saved {ids.length === 1 ? 'product' : 'products'}
        </p>
      )}
      {!ready || view.key !== key || view.state === 'loading' ? (
        <p role="status" className="wishlist-message">
          Loading your saved products...
        </p>
      ) : view.state === 'error' ? (
        <div role="alert" className="wishlist-message">
          <h2>Your saved products could not be loaded.</h2>
          <p>Your list is still here. Please try again.</p>
          <button type="button" className="button button-outline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : ids.length === 0 ? (
        <div className="wishlist-message">
          <h2>Your wishlist is empty.</h2>
          <p>Use the heart on a product to save it here.</p>
          <Link className="button button-dark" href="/shop" prefetch={false}>
            Explore products
          </Link>
        </div>
      ) : (
        <div className="wishlist-grid">
          {ids.map((id) => {
            const p = cards.get(id);
            return p ? (
              <ProductCard key={id} product={p} />
            ) : (
              <article key={id} className="saved-unavailable">
                <h2>Unavailable product</h2>
                <p>This saved product is not currently published.</p>
                <button
                  type="button"
                  className="button button-outline"
                  disabled={pending}
                  onClick={() => void setSaved(id, false)}
                >
                  Remove unavailable product
                </button>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
