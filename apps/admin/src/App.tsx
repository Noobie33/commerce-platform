import { startStaffUpdates } from './data/live-channel';
import { useEffect, useState } from 'react';
import { StaffApi } from './api';
import { SignIn, ChangePassword } from './auth';
import { Brand } from './icons';
import { Workspace } from './workspace';
import type { Profile } from './types';

export default function App() {
  const [api] = useState(() => new StaffApi());
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    let active = true;
    api.onSessionExpired = () => {
      setUser(null);
      setNotice('Your session ended. Please sign in again.');
    };
    api.onPasswordChangeRequired = () =>
      setUser((current) => (current ? { ...current, mustChangePassword: true } : current));
    api
      .me()
      .then((profile) => {
        if (active) setUser(profile);
      })
      .catch((err) => {
        if (active && !(err && typeof err === 'object' && 'status' in err && err.status === 401))
          setError(err instanceof Error ? err.message : 'Unable to open your workspace.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      api.onSessionExpired = undefined;
      api.onPasswordChangeRequired = undefined;
    };
  }, [api]);
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    return startStaffUpdates(() => {
      api.forget();
      api.onSessionExpired?.();
    });
  }, [api, user?.id, user?.mustChangePassword]);
  const signedOut = (message: string) => {
    api.forget();
    setUser(null);
    setNotice(message);
  };
  async function logoutForced() {
    setSigningOut(true);
    setActionError('');
    try {
      await api.logout();
      signedOut('You have signed out.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }
  if (loading)
    return (
      <main className="centered-screen">
        <Brand />
        <span className="spinner" aria-hidden="true" />
        <p role="status">Opening your workspace…</p>
      </main>
    );
  if (error)
    return (
      <main className="centered-screen">
        <Brand />
        <h1>We couldn’t open your workspace.</h1>
        <p className="muted" role="alert">
          {error}
        </p>
        <button className="button button-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  if (!user)
    return (
      <SignIn
        api={api}
        notice={notice}
        onSignedIn={(profile) => {
          setNotice('');
          setUser(profile);
        }}
      />
    );
  if (user.mustChangePassword)
    return (
      <main className="onboarding-screen">
        <header>
          <Brand />
          <button className="text-button" disabled={signingOut} onClick={() => void logoutForced()}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </header>
        <div className="onboarding-caption">
          <span className="eyebrow">YOUR FIRST SIGN-IN</span>
          <p>Welcome, {user.displayName}.</p>
        </div>
        <div className="panel onboarding-card">
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <ChangePassword api={api} forced onSignedOut={signedOut} />
        </div>
        <p className="onboarding-footer">A personal password keeps your workspace yours.</p>
      </main>
    );
  return <Workspace api={api} user={user} onSignedOut={signedOut} onProfile={setUser} />;
}
