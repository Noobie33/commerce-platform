'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SAVED_KEY, SAVED_LIMIT, readSaved, writeSaved, updateSaved } from '../lib/saved-products';
import { Icon } from './icon';
type SavedState = {
  ids: string[];
  ready: boolean;
  pending: boolean;
  setSaved: (id: string, wanted: boolean) => Promise<void>;
};
const Context = createContext<SavedState | null>(null);
export function SavedProductsProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]),
    [ready, setReady] = useState(false),
    [pending, setPending] = useState(false),
    [persistent, setPersistent] = useState(true),
    [message, setMessage] = useState(''),
    current = useRef<string[]>([]),
    canPersist = useRef(true),
    queue = useRef<Promise<void>>(Promise.resolve());
  const sync = useCallback((next: string[]) => {
    current.current = next;
    setIds((old) => (old.join(',') === next.join(',') ? old : next));
  }, []);
  const memory = useCallback(() => {
    canPersist.current = false;
    setPersistent(false);
  }, []);
  useEffect(() => {
    try {
      sync(readSaved(localStorage.getItem(SAVED_KEY)));
    } catch {
      memory();
    }
    setReady(true);
    const changed = (e: StorageEvent) => {
      try {
        if (
          (e.key === SAVED_KEY || e.key === null) &&
          e.storageArea === localStorage &&
          canPersist.current
        )
          sync(readSaved(localStorage.getItem(SAVED_KEY)));
      } catch {
        memory();
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [sync, memory]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const setSaved = useCallback(
    (id: string, wanted: boolean) => {
      const job = queue.current
        .catch(() => {})
        .then(async () => {
          setPending(true);
          const apply = () => {
            let latest = current.current;
            if (canPersist.current)
              try {
                latest = readSaved(localStorage.getItem(SAVED_KEY));
              } catch {
                memory();
              }
            const result = updateSaved(latest, id, wanted);
            if (result.full) {
              sync(latest);
              setMessage(
                'Your wishlist is full (' + SAVED_LIMIT + ' products). Remove one to add another.',
              );
              return;
            }
            if (canPersist.current)
              try {
                localStorage.setItem(SAVED_KEY, writeSaved(result.ids));
              } catch {
                memory();
              }
            sync(result.ids);
            setMessage(wanted ? 'Saved to your wishlist.' : 'Removed from your wishlist.');
          };
          try {
            if (navigator.locks)
              await navigator.locks.request(
                SAVED_KEY,
                { signal: AbortSignal.timeout(3000) },
                apply,
              );
            else apply();
          } catch (e) {
            if (e instanceof DOMException && e.name === 'SecurityError') {
              memory();
              apply();
            } else setMessage('Your wishlist is busy. Please try again.');
          } finally {
            setPending(false);
          }
        });
      queue.current = job;
      return job;
    },
    [sync, memory],
  );
  return (
    <Context.Provider value={{ ids, ready, pending, setSaved }}>
      {children}
      {ready && !persistent && (
        <p className="saved-storage-notice" role="status">
          This browser could not keep your wishlist. Changes will last for this visit only.
        </p>
      )}
      <p className="saved-toast" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </Context.Provider>
  );
}
export function useSavedProducts() {
  const v = useContext(Context);
  if (!v) throw Error('Saved products provider is missing');
  return v;
}
export function SaveProductButton({
  productId,
  name,
  compact = false,
}: {
  productId: string;
  name: string;
  compact?: boolean;
}) {
  const { ids, ready, pending, setSaved } = useSavedProducts(),
    saved = ids.includes(productId);
  return (
    <button
      type="button"
      className={
        (compact ? 'card-save-button' : 'product-save-button') + (saved ? ' is-saved' : '')
      }
      disabled={!ready || pending}
      aria-pressed={saved}
      aria-label={
        (saved ? 'Remove ' : 'Save ') + name + (saved ? ' from wishlist' : ' to wishlist')
      }
      onClick={() => void setSaved(productId, !saved)}
    >
      <Icon name="heart" />
      {!compact && <span>{saved ? 'Saved to wishlist' : 'Save to wishlist'}</span>}
    </button>
  );
}
export function WishlistLink() {
  const { ids, ready } = useSavedProducts();
  return (
    <Link
      className="wishlist-nav icon-button"
      href="/wishlist"
      prefetch={false}
      aria-label={'Wishlist (' + (ready ? ids.length : 0) + ')'}
    >
      <Icon name="heart" />
      {ready && ids.length > 0 && (
        <span className="wishlist-count" aria-hidden="true">
          {ids.length}
        </span>
      )}
    </Link>
  );
}
