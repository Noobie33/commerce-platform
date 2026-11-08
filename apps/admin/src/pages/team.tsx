import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Icon } from '../icons';
import type { Profile, TeamMember } from '../types';
export function Team({ api, user }: { api: StaffApi; user: Profile }) {
  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setRows(null);
    setError('');
    api
      .team()
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load the team.');
      });
    return () => {
      active = false;
    };
  }, [api, revision]);
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
                        {row.isActive ? 'Active' : 'Inactive'}
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
