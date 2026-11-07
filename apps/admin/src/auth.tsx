import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, StaffApi } from './api';
import { Brand, Icon } from './icons';
import type { Profile } from './types';

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  id: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <span className="password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          maxLength={512}
        />
        <button
          type="button"
          className="icon-button password-toggle"
          aria-label={visible ? 'Hide ' + label.toLowerCase() : 'Show ' + label.toLowerCase()}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <Icon name="eye" />
        </button>
      </span>
    </label>
  );
}

export function SignIn({
  api,
  onSignedIn,
  notice,
}: {
  api: StaffApi;
  onSignedIn: (user: Profile) => void;
  notice: string;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await api.login(username, password);
      setPassword('');
      onSignedIn(user);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Username or password is incorrect.'
          : err instanceof Error
            ? err.message
            : 'Unable to sign in. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand light />
        <div className="auth-story-main">
          <span className="eyebrow story-eyebrow">BUILT AROUND YOUR BUSINESS</span>
          <h1>
            One workspace.
            <br />
            <em>Room to grow.</em>
          </h1>
          <p>A considered home for your people, products and everyday operations.</p>
          <div className="story-map" aria-label="Workspace roadmap">
            <span className="story-active">
              <Icon name="check" /> People & access
            </span>
            <span>Products</span>
            <span>Inventory</span>
            <span>Sales</span>
          </div>
        </div>
        <div className="story-footer">
          <span className="tiny-diamond" /> Made for the way your business grows.
        </div>
      </section>
      <section className="auth-content">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <span className="pill">
            <Icon name="lock" /> PRIVATE STAFF WORKSPACE
          </span>
          <h2>Welcome back.</h2>
          <p className="muted auth-intro">Sign in to your business workspace.</p>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <form onSubmit={submit} className="form-stack" aria-label="Sign in">
            <label className="field" htmlFor="username">
              <span>Username</span>
              <input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your staff username"
                required
                maxLength={64}
              />
            </label>
            <PasswordField id="password" label="Password" value={password} onChange={setPassword} />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button button-primary auth-submit" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
              {!busy && <Icon name="arrow" />}
            </button>
          </form>
          <p className="auth-help">Access is managed by your workspace owner.</p>
        </div>
        <footer className="auth-footer">
          <span>Commerce workspace</span>
          <span>Private by design</span>
        </footer>
      </section>
    </main>
  );
}

export function ChangePassword({
  api,
  forced = false,
  onSignedOut,
}: {
  api: StaffApi;
  forced?: boolean;
  onSignedOut: (notice: string) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const length = [...next.normalize('NFC')].length;
    if (length < 15 || length > 128) {
      setError('Use a passphrase of 15 to 128 characters.');
      return;
    }
    if (next !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    if (next.normalize('NFC') === current.normalize('NFC')) {
      setError('Choose a different password from your current one.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      onSignedOut('Password updated. Sign in with your new password.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        try {
          await api.me();
          setError('Your current password could not be verified.');
        } catch {
          onSignedOut('Your session ended. Please sign in again.');
        }
      } else setError(err instanceof Error ? err.message : 'Unable to update your password.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={'password-panel' + (forced ? ' forced-panel' : '')}>
      <span className="section-icon">
        <Icon name="lock" />
      </span>
      <h2>{forced ? 'Make this workspace yours.' : 'Change your password'}</h2>
      <p className="muted">
        {forced
          ? 'Before you begin, replace your one-time password with a password only you know.'
          : 'Updating your password signs you out of all current sessions.'}
      </p>
      <form onSubmit={submit} className="form-stack" aria-label="Change password">
        <PasswordField
          id="current-password"
          label="Current password"
          value={current}
          onChange={setCurrent}
        />
        <PasswordField
          id="new-password"
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
        />
        <p className="field-hint">Use a memorable passphrase of at least 15 characters.</p>
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? 'Updating password…' : 'Update password'}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
    </section>
  );
}
