'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Product } from '../lib/catalog-contract';
import { Icon } from './icon';
import { productSelection } from '../lib/catalog-contract';
const Experience = dynamic(() => import('./product-experience').then((m) => m.ProductExperience), {
  loading: () => (
    <p role="status" className="quick-view-message">
      Preparing product view...
    </p>
  ),
});
type RequestProduct = { slug: string; name: string; selection: Record<string, string> };
type State =
  | { kind: 'loading'; request: RequestProduct }
  | { kind: 'ready'; request: RequestProduct; product: Product }
  | { kind: 'error'; request: RequestProduct; missing: boolean };
const Context = createContext<((p: RequestProduct) => void) | null>(null);
export function QuickViewProvider({ children }: { children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null),
    controller = useRef<AbortController | null>(null),
    current = useRef<RequestProduct | null>(null),
    serial = useRef(0),
    [state, setState] = useState<State | null>(null),
    pathname = usePathname();
  const cancel = useCallback(() => {
    serial.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);
  const close = useCallback(() => {
    cancel();
    current.current = null;
    setState(null);
    dialog.current?.close();
  }, [cancel]);
  const load = useCallback(
    async (request: RequestProduct) => {
      cancel();
      current.current = request;
      const id = serial.current,
        abort = new AbortController();
      controller.current = abort;
      setState({ kind: 'loading', request });
      try {
        const r = await fetch('/product-preview/' + encodeURIComponent(request.slug), {
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]),
          headers: { Accept: 'application/json' },
        });
        if (id !== serial.current || abort.signal.aborted) return;
        if (!r.ok) {
          setState({ kind: 'error', request, missing: r.status === 404 });
          return;
        }
        const product = (await r.json()) as Product;
        if (id !== serial.current || abort.signal.aborted) return;
        if (product.slug !== request.slug || !product.gallery?.length || !product.variants?.length)
          throw Error('Invalid product preview');
        setState({ kind: 'ready', request, product });
      } catch {
        if (id === serial.current && !abort.signal.aborted)
          setState({ kind: 'error', request, missing: false });
      }
    },
    [cancel],
  );
  const remember = useCallback((selection: Record<string, string>) => {
    if (current.current) current.current = { ...current.current, selection };
  }, []);
  const open = useCallback(
    (request: RequestProduct) => {
      dialog.current?.showModal();
      void load(request);
    },
    [load],
  );
  useEffect(() => {
    close();
  }, [pathname, close]);
  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    const refresh = () => {
      if (
        dialog.current?.open &&
        current.current &&
        document.visibilityState === 'visible' &&
        navigator.onLine
      )
        void load(current.current);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('popstate', close);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('popstate', close);
    };
  }, [load, close]);
  return (
    <Context.Provider value={open}>
      {children}
      <dialog
        className="quick-view"
        ref={dialog}
        aria-labelledby="quick-view-title"
        onClose={() => {
          if (!dialog.current?.open) close();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
      >
        <header className="quick-view-heading">
          <h2 id="quick-view-title" className="sr-only">
            Quick view{state ? ' / ' + state.request.name : ''}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close quick view"
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        {state?.kind === 'loading' && (
          <p className="quick-view-message" role="status">
            Loading product details...
          </p>
        )}
        {state?.kind === 'error' && (
          <div className="quick-view-message" role="alert">
            <h3>
              {state.missing
                ? 'This product is currently unavailable.'
                : 'Product details could not be loaded.'}
            </h3>
            <p>{state.missing ? 'It may no longer be published.' : 'Please try again.'}</p>
            {!state.missing && (
              <button className="button button-outline" onClick={() => void load(state.request)}>
                Try again
              </button>
            )}
          </div>
        )}
        {state?.kind === 'ready' && (
          <Experience
            key={state.product.productId + ':' + state.product.releaseVersion}
            product={state.product}
            initialSelection={productSelection(state.product, state.request.selection)}
            preview
            onViewDetails={close}
            onSelectionChange={remember}
            onMediaUnavailable={() => {
              cancel();
              setState({
                kind: 'error',
                request: current.current ?? state.request,
                missing: false,
              });
            }}
          />
        )}
      </dialog>
    </Context.Provider>
  );
}
export function QuickViewButton({ slug, name, selection = {} }: RequestProduct) {
  const open = useContext(Context);
  return (
    <button
      type="button"
      className="quick-view-trigger"
      aria-label={'Quick view: ' + name}
      onClick={() => open?.({ slug, name, selection })}
    >
      QUICK VIEW
    </button>
  );
}
