import { useState } from 'react';
import { StaffApi } from '../api';
import { ChangePassword } from '../auth';
import { Icon } from '../icons';
import { permissionNames } from '../access';
import type { Profile } from '../types';
export function ProfilePage({
  api,
  user,
  onSignedOut,
  onRefresh,
}: {
  api: StaffApi;
  user: Profile;
  onSignedOut: (notice: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groups = [...new Set(user.grants.map((grant) => grant.code))];
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh access.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">YOUR ACCOUNT</span>
          <h1 id="page-title" tabIndex={-1}>
            Your profile.
          </h1>
          <p className="muted">Your details, access and account security.</p>
        </div>
      </header>
      <div className="profile-grid">
        <div>
          <section className="panel profile-card">
            <span className="avatar avatar-large">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <h2>{user.displayName}</h2>
            <p className="muted">{user.username}</p>
            <span className="badge badge-green">Active staff account</span>
          </section>
          <section className="panel access-panel">
            <div className="section-header">
              <h2>Your access</h2>
              <button
                className="icon-button"
                aria-label="Refresh access"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <Icon name="refresh" />
              </button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {groups.length === 0 ? (
              <p className="muted">No business permissions have been assigned yet.</p>
            ) : (
              <ul className="access-list">
                {groups.map((code) => (
                  <li key={code}>
                    <span>{permissionNames[code] ?? 'Additional workspace access'}</span>
                    <small>
                      {user.grants.some((grant) => grant.code === code && grant.locationId === null)
                        ? 'All locations'
                        : 'Assigned locations'}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="panel">
          <ChangePassword api={api} onSignedOut={onSignedOut} />
        </div>
      </div>
    </>
  );
}
