import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import { lazy, Suspense, useCallback, useState } from 'react';
const AccessManagement = lazy(() =>
  import('./access-management').then((m) => ({ default: m.AccessManagement })),
);
import { StaffApi } from '../api';
import { Icon } from '../icons';
import type { Profile } from '../types';
const EmployeeOnboarding = lazy(() =>
  import('./employee-onboarding').then((m) => ({ default: m.EmployeeOnboarding })),
);
export function Team({ api, user }: { api: StaffApi; user: Profile }) {
  const [query, setQuery] = useState('');
  const [manage, setManage] = useState(false);
  const [onboarding, setOnboarding] = useState(false);

  const [revision, setRevision] = useState(0);
  const read = useLiveRead(
    useCallback((options) => api.team(options), [api]),
    { topics: ['team'], revision, paused: manage || onboarding },
  );
  const rows = read.data,
    error = read.error;
  const filtered = rows?.filter((row) =>
    (row.displayName + ' ' + row.username).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">PEOPLE & ACCESS</span>
          <h1 id="page-title" tabIndex={-1}>
            Your team.
          </h1>
          <p className="muted">A clear view of the people in your workspace.</p>
        </div>
        <button className="button button-secondary" onClick={() => setRevision(revision + 1)}>
          <Icon name="refresh" />
          Refresh team
        </button>
      </header>
      {user.grants.some((g) => g.code === 'staff.manage' && g.locationId === null) && (
        <button className="button button-primary" onClick={() => setManage(true)}>
          Manage team access
        </button>
      )}
      {user.grants.some((g) => g.code === 'staff.manage' && g.locationId === null) && (
        <button className="button button-secondary" onClick={() => setOnboarding(true)}>
          Employee onboarding
        </button>
      )}
      {onboarding && (
        <Suspense fallback={<p role="status">Opening employee onboarding...</p>}>
          <EmployeeOnboarding
            api={api}
            close={() => {
              setOnboarding(false);
              setRevision((n) => n + 1);
            }}
          />
        </Suspense>
      )}
      {manage && (
        <Suspense fallback={<p>Opening access management...</p>}>
          <AccessManagement
            api={api}
            close={() => {
              setManage(false);
              setRevision((n) => n + 1);
            }}
          />
        </Suspense>
      )}
      <ReadStatus read={read} />

      <section className="panel team-panel">
        <div className="team-toolbar">
          <div>
            <h2>Staff accounts</h2>
            <p className="muted small">
              {rows
                ? rows.length +
                  (rows.length === 100 ? '+ members' : rows.length === 1 ? ' member' : ' members')
                : 'Loading your team…'}
            </p>
          </div>
          <label className="search-box">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search team"
              placeholder="Find a team member…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {error ? (
          <div className="empty-state" role="alert">
            <p>{error}</p>
            <button className="text-button" onClick={() => setRevision(revision + 1)}>
              Try again
              <Icon name="arrow" />
            </button>
          </div>
        ) : !rows ? (
          <div className="empty-state" role="status">
            Loading team members…
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered?.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="table-person">
                        <span className="avatar avatar-soft">
                          {row.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{row.displayName}</strong>
                        {row.id === user.id && <span className="you-label">You</span>}
                      </span>
                    </td>
                    <td>{row.username}</td>
                    <td>
                      <span className={'badge ' + (row.isActive ? 'badge-green' : 'badge-neutral')}>
                        {!row.isActive
                          ? 'Inactive'
                          : row.onboardingState === 'pending'
                            ? 'Awaiting activation'
                            : row.onboardingState === 'expired'
                              ? 'Code expired'
                              : row.onboardingState === 'revoked'
                                ? 'Activation revoked'
                                : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered?.length === 0 && (
              <div className="empty-state">No team members match your search.</div>
            )}
          </div>
        )}
        <footer className="table-footer">
          Read-only staff directory
          {rows?.length === 100
            ? ' · Showing the first 100 accounts; search applies to this list.'
            : ''}
        </footer>
      </section>
    </>
  );
}
