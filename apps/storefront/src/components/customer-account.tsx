'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { accountView } from '../lib/account-contract';
import type { AccountView } from '../lib/account-contract';
export function CustomerAccountPage() {
  const [view, setView] = useState<AccountView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [shown, setShown] = useState(false),
    read = useRef<AbortController | null>(null),
    auth = useRef<AbortController | null>(null),
    serial = useRef(0),
    writing = useRef(false),
    channel = useRef<BroadcastChannel | null>(null),
    last = useRef(0);
  const load = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController(),
      id = ++serial.current;
    read.current = controller;
    last.current = Date.now();
    try {
      const r = await fetch('/account/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!r.ok) throw Error('Account unavailable');
      const next = accountView(await r.json());
      if (id === serial.current && !controller.signal.aborted) {
        setView(next);
        setError('');
      }
    } catch {
      if (id === serial.current && !controller.signal.aborted) {
        setView(null);
        setError('Your account could not be loaded. Please try again.');
      }
    }
  }, []);
  useEffect(() => {
    void load();
    const changed = () => {
      if (
        !writing.current &&
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        Date.now() - last.current > 1000
      )
        void load();
    };
    window.addEventListener('focus', changed);
    window.addEventListener('online', changed);
    document.addEventListener('visibilitychange', changed);
    if (typeof BroadcastChannel !== 'undefined') {
      const c = new BroadcastChannel('commerce.customer.session.v1');
      channel.current = c;
      c.onmessage = (e) => {
        if (e.data === 'changed' && !writing.current) void load();
      };
    }
    return () => {
      serial.current++;
      read.current?.abort();
      auth.current?.abort();
      channel.current?.close();
      window.removeEventListener('focus', changed);
      window.removeEventListener('online', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [load]);
  async function act(action: 'login' | 'logout') {
    if (writing.current) return;
    writing.current = true;
    serial.current++;
    read.current?.abort();
    setBusy(true);
    setError('');
    const controller = new AbortController();
    auth.current = controller;
    try {
      const r = await fetch('/account/' + action, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'commerce-store' },
        body: JSON.stringify(action === 'login' ? { email, password } : {}),
      });
      if (!r.ok) {
        setError(
          r.status === 401
            ? 'Email or password was not accepted.'
            : r.status === 429
              ? 'Too many sign-in attempts. Please try later.'
              : r.status === 400
                ? 'Check your email and password.'
                : 'Your account is temporarily unavailable. Please try again.',
        );
        return;
      }
      setPassword('');
      setShown(false);
      await load();
      channel.current?.postMessage('changed');
    } catch {
      if (!controller.signal.aborted) setError('Unable to reach your account. Please try again.');
      else if (!read.current?.signal.aborted) setError('The request timed out. Please try again.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="customer-account-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/" prefetch={false}>
          Home
        </Link>
        <span>/</span>
        <span>My account</span>
      </nav>
      <h1>MY ACCOUNT</h1>
      {!view && !error ? (
        <p role="status" className="account-notice">
          Loading your account...
        </p>
      ) : null}
      {error && (
        <div role="alert" className="account-error">
          <p>{error}</p>
          {!view && (
            <button className="button button-outline" onClick={() => void load()}>
              Try again
            </button>
          )}
        </div>
      )}
      {view?.state === 'closed' && (
        <section className="account-notice">
          <h2>Customer sign-in is not open yet.</h2>
          <p>You can still explore our collection and save products on this browser.</p>
          <Link href="/shop" prefetch={false} className="button button-dark">
            Explore products
          </Link>
        </section>
      )}
      {view?.state === 'signed-out' && (
        <div className="account-columns">
          <section className="account-intro">
            <h2>Welcome back</h2>
            <p>Sign in with your customer email and password.</p>
            <p className="account-preview-note">
              Sign-in preview for prepared accounts. Registration and password recovery are not open
              yet.
            </p>
          </section>
          <form
            className="account-form"
            aria-label="Customer sign in"
            onSubmit={(e) => {
              e.preventDefault();
              void act('login');
            }}
          >
            <label htmlFor="customer-email">Email address</label>
            <input
              id="customer-email"
              name="email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="customer-password">Password</label>
            <div className="account-password">
              <input
                id="customer-password"
                name="password"
                type={shown ? 'text' : 'password'}
                autoComplete="current-password"
                maxLength={256}
                required
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => setShown(!shown)}
                aria-label={shown ? 'Hide password' : 'Show password'}
                aria-pressed={shown}
              >
                {shown ? 'Hide' : 'Show'}
              </button>
            </div>
            <button className="button button-dark" disabled={busy}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      )}
      {view?.state === 'signed-in' && (
        <div className="account-columns">
          <section className="account-intro">
            <h2>Welcome, {view.account.displayName}</h2>
            <p>You are signed in to your customer account.</p>
            <button
              className="button button-outline"
              disabled={busy}
              onClick={() => void act('logout')}
            >
              {busy ? 'Signing out...' : 'Sign out'}
            </button>
          </section>
          <section className="account-profile">
            <h2>Your details</h2>
            <dl>
              <dt>Name</dt>
              <dd>{view.account.displayName}</dd>
              <dt>Email</dt>
              <dd>{view.account.email}</dd>
            </dl>
            <Link href="/wishlist" prefetch={false}>
              View your wishlist
            </Link>
            <p className="account-preview-note">
              Your wishlist is saved on this browser. Account syncing, address management and order
              history are later steps; online ordering is not open yet.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
