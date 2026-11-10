import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { PasswordField } from '../auth';
import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import type { EnrollmentInput, EnrollmentView, EnrollmentResult } from './onboarding-types';
import '../catalog/content.css';
import './employee-onboarding.css';
const status = (s: string) =>
  ({
    pending: 'Awaiting activation',
    expired: 'Code expired',
    accepted: 'Activated',
    revoked: 'Code revoked',
    disabled: 'Account disabled',
  })[s] ?? s;
export function EmployeeOnboarding({ api, close }: { api: StaffApi; close: () => void }) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [selected, setSelected] = useState<EnrollmentView | null>(null),
    [form, setForm] = useState<EnrollmentInput | null>(null),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState<
      (EnrollmentResult & { recipientName: string; recipientUsername: string }) | null
    >(null),
    [showCode, setShowCode] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null),
    ticket = useRef(0),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty =
    !!form && (form.reason.length > 0 || !!form.username || !!form.displayName || !!password);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(
    () => () => {
      ticket.current++;
    },
    [],
  );
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty && !secret) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, secret]);
  const read = useLiveRead(
    useCallback((o) => api.enrollments(query, page, o), [api, query, page]),
    { topics: ['team'], allowInDialog: true, paused: !!form || !!selected || !!secret, revision },
  );
  useEffect(() => {
    if (read.data && page > Math.max(1, Math.ceil(read.data.total / 20)))
      setPage(Math.max(1, Math.ceil(read.data.total / 20)));
  }, [read.data, page]);
  const dismiss = () => {
    if (busy) return;
    if (dirty || secret) setConfirmClose(true);
    else close();
  };
  async function open(id: string, p = 1) {
    const n = ++ticket.current;
    setError('');
    try {
      const v = await api.enrollment(id, p);
      if (n === ticket.current) setSelected(v);
    } catch (e) {
      if (n === ticket.current)
        setError(e instanceof Error ? e.message : 'Unable to load activation.');
    }
  }
  function begin(action: EnrollmentInput['action']) {
    ticket.current++;
    setSecret(null);
    setShowCode(false);
    setPassword('');
    setError('');
    setNotice('');
    setForm({
      action,
      id: action === 'create' ? crypto.randomUUID() : selected!.record.id,
      expectedVersion: action === 'create' ? 0 : selected!.record.version,
      reason: '',
      ...(action === 'create' ? { username: '', displayName: '' } : {}),
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    const body = JSON.stringify(form);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    let recorded = false;
    try {
      const result = await api.saveEnrollment(form, password, retry.current.key);
      recorded = true;
      setPassword('');
      setForm(null);
      refresh((n) => n + 1);
      if (result.activationCode) {
        setSecret({
          ...result,
          recipientName: form.displayName?.trim() ?? selected!.record.displayName,
          recipientUsername: form.username?.trim().toLowerCase() ?? selected!.record.username,
        });
        setShowCode(false);
        setNotice('Activation code issued. Copy it privately now; it cannot be retrieved later.');
      } else
        setNotice(
          result.replayed
            ? 'This action was already recorded. Its code cannot be shown again; issue a new code if needed.'
            : 'Activation code revoked.',
        );
      await open(result.staffId);
    } catch (e) {
      setError(
        recorded
          ? 'Saved. Reopen this account to see the current state.'
          : e instanceof Error
            ? e.message
            : 'Unable to save onboarding.',
      );
      setPassword('');
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!secret?.activationCode) return;
    try {
      await navigator.clipboard.writeText(secret.activationCode);
      setSecret(null);
      setShowCode(false);
      setNotice(
        'Code copied. Share it privately with the named employee; it cannot be retrieved again.',
      );
    } catch {
      setError(
        'Clipboard access is unavailable. Use Show code and copy it manually, then clear it.',
      );
    }
  }
  return (
    <Dialog
      title="Employee onboarding"
      subtitle="Personal staff accounts with one-time activation"
      wide
      onClose={dismiss}
    >
      <div className="product-content-body employee-onboarding">
        <p className="content-boundary">
          Only the owner creates accounts. Employees set their own password. A new account starts
          without business roles; assign only the required roles through Manage team access.
        </p>
        {(error || read.error) && (
          <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error || read.error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {confirmClose && (
          <section className="content-readiness" role="alert">
            <h3>Close this panel?</h3>
            <p>
              Unsaved details and any activation code not copied will be lost from this screen.
              Issued codes remain valid until expiry or revocation.
            </p>
            <div className="merch-actions">
              <button className="secondary-button" onClick={() => setConfirmClose(false)}>
                Keep this panel open
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setSecret(null);
                  setPassword('');
                  close();
                }}
              >
                Close and discard this screen
              </button>
            </div>
          </section>
        )}
        {secret && (
          <section className="content-readiness enrollment-secret">
            <h3>One-time activation code for {secret.recipientName}</h3>
            <p>
              Username: <strong>{secret.recipientUsername}</strong>
            </p>
            <p>
              For the account shown below. Expires{' '}
              {new Date(secret.expiresAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}{' '}
              (Dhaka).
            </p>
            <p>
              Activation page:{' '}
              <a href={secret.activationUrl} target="_blank" rel="noreferrer">
                Open activation page
              </a>
            </p>
            <p className="activation-code">
              {showCode
                ? secret.activationCode
                : 'Code hidden. Copy it now or show it to copy manually.'}
            </p>
            <div className="merch-actions">
              <button className="primary-button" onClick={() => void copy()}>
                Copy activation code
              </button>
              <button className="secondary-button" onClick={() => setShowCode((v) => !v)}>
                {showCode ? 'Hide code' : 'Show code'}
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setSecret(null);
                  setShowCode(false);
                }}
              >
                Clear code from this screen
              </button>
            </div>
            <p>
              Share the username and code privately with that employee. Never share your owner
              password.
            </p>
          </section>
        )}
        {form ? (
          <form onSubmit={save}>
            <fieldset disabled={busy} className="content-fields">
              {form.action === 'create' ? (
                <>
                  <label>
                    Employee display name
                    <input
                      required
                      maxLength={120}
                      value={form.displayName}
                      onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    />
                  </label>
                  <label>
                    Username
                    <input
                      required
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={64}
                      pattern="[a-zA-Z0-9._-]{3,64}"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                    <small>3 to 64 letters, numbers, dots, dashes or underscores.</small>
                  </label>
                </>
              ) : (
                <p>
                  {form.action === 'reissue'
                    ? 'Issue a fresh code and invalidate the previous one.'
                    : 'Revoke the pending code. This does not reset an activated password.'}
                </p>
              )}
              <label>
                Reason for this action
                <textarea
                  required
                  maxLength={500}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
              <PasswordField
                id="enrollment-owner-password"
                label="Confirm your owner password"
                value={password}
                onChange={setPassword}
              />
            </fieldset>
            <div className="merch-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setForm(null);
                  setPassword('');
                }}
              >
                Cancel editing
              </button>
              <button className="primary-button" disabled={busy}>
                {busy
                  ? 'Saving...'
                  : form.action === 'create'
                    ? 'Create account and code'
                    : form.action === 'reissue'
                      ? 'Issue new activation code'
                      : 'Revoke activation code'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {!secret && (
              <button
                className="primary-button"
                onClick={() => {
                  setSelected(null);
                  begin('create');
                }}
              >
                Add employee account
              </button>
            )}
            <ReadStatus read={read} />
            <label>
              Search employee activations
              <input
                type="search"
                maxLength={120}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {read.data?.items.map((r) => (
              <button
                className="enrollment-record"
                disabled={!!secret || busy}
                key={r.id}
                onClick={() => void open(r.id)}
              >
                <strong>{r.displayName}</strong>
                <span>
                  {r.username} / {status(r.status)} / revision {r.version}
                </span>
              </button>
            ))}
            {read.data?.items.length === 0 && (
              <p>No employee activation records yet. Existing accounts are unchanged.</p>
            )}
            <div className="merch-actions">
              <button
                className="secondary-button"
                disabled={page === 1 || !!secret}
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n - 1);
                }}
              >
                Previous employees
              </button>
              <span>
                Page {page} / {read.data?.total ?? 0} accounts
              </span>
              <button
                className="secondary-button"
                disabled={!!secret || page * 20 >= (read.data?.total ?? 0)}
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n + 1);
                }}
              >
                Next employees
              </button>
            </div>
            {selected && (
              <section className="content-history">
                <h3>{selected.record.displayName}</h3>
                <p>
                  Username: {selected.record.username} / {status(selected.record.status)}
                </p>
                <p>Activation revision {selected.record.version}</p>
                {!secret && selected.record.state !== 'accepted' && (
                  <div className="merch-actions">
                    <button
                      className="secondary-button"
                      disabled={!selected.record.active}
                      onClick={() => begin('reissue')}
                    >
                      Issue a new code
                    </button>
                    <button
                      className="secondary-button"
                      disabled={selected.record.state !== 'pending'}
                      onClick={() => begin('revoke')}
                    >
                      Revoke pending code
                    </button>
                  </div>
                )}
                <h4>Activation history</h4>
                {selected.history.map((h) => (
                  <details key={h.version}>
                    <summary>
                      Revision {h.version} / {h.action.replaceAll('_', ' ')}
                    </summary>
                    <p>{h.reason}</p>
                    <p>
                      {h.actorName} /{' '}
                      {new Date(h.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}{' '}
                      (Dhaka)
                    </p>
                  </details>
                ))}
                <div className="merch-actions">
                  <button
                    className="secondary-button"
                    disabled={selected.page === 1 || !!secret}
                    onClick={() => void open(selected.record.id, selected.page - 1)}
                  >
                    Newer activation history
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!selected.hasMore || !!secret}
                    onClick={() => void open(selected.record.id, selected.page + 1)}
                  >
                    Older activation history
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
