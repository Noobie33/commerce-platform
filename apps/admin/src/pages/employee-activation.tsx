import './employee-onboarding.css';
import { useEffect, useRef, useState } from 'react';
import { Brand } from '../icons';
import { PasswordField } from '../auth';
import { StaffApi } from '../api';
import type { FormEvent } from 'react';
export function EmployeeActivation({
  api,
  onSignIn,
}: {
  api: StaffApi;
  onSignIn: (message?: string) => void;
}) {
  const [username, setUsername] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (password.normalize('NFC') !== confirm.normalize('NFC')) {
      setError('Both password entries must match.');
      return;
    }
    const length = [...password.normalize('NFC')].length;
    if (length < 15 || length > 128) {
      setError('Use a password containing 15 to 128 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.activateEmployee(username, code, password);
      setDone(true);
      setCode('');
      setPassword('');
      setConfirm('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to activate this account.');
      setPassword('');
      setConfirm('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-screen employee-activation">
      <header>
        <Brand />
      </header>
      <div className="onboarding-caption">
        <span className="eyebrow">YOUR PERSONAL STAFF ACCOUNT</span>
        <h1>{done ? 'Your account is ready.' : 'Activate your staff account.'}</h1>
      </div>
      <section className="panel onboarding-card">
        {done ? (
          <>
            <p>Your password is set. Sign in with your username and the password you chose.</p>
            <button
              className="button button-primary"
              onClick={() => onSignIn('Account activated. Sign in with your own password.')}
            >
              Go to sign in
            </button>
          </>
        ) : (
          <>
            <p>
              Use the username and one-time code provided privately by your owner. Choose your own
              password; the owner does not need to know it.
            </p>
            {error && (
              <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
                {error}
              </p>
            )}
            <form onSubmit={submit}>
              <fieldset className="activation-fields" disabled={busy}>
                <label>
                  Username
                  <input
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={64}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label>
                  Activation code
                  <input
                    required
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={60}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <PasswordField
                  id="activation-new-password"
                  label="Choose your password"
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                />
                <PasswordField
                  id="activation-confirm-password"
                  label="Confirm your password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={setConfirm}
                />
                <p className="muted small">
                  15 to 128 characters. You can use a long, memorable passphrase.
                </p>
                <button className="button button-primary" disabled={busy}>
                  {busy ? 'Activating...' : 'Activate account'}
                </button>
              </fieldset>
            </form>
            <button className="text-button" disabled={busy} onClick={() => onSignIn()}>
              Already activated? Sign in
            </button>
          </>
        )}
      </section>
      <p className="onboarding-footer">Activation codes expire and can be used once.</p>
    </main>
  );
}
