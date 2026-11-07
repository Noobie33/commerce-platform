import { useEffect, useState } from 'react';
import { StaffApi } from './api';
import { ChangePassword } from './auth';
import { Brand, Icon } from './icons';
import type { Profile, TeamMember } from './types';

type Page = 'overview' | 'team' | 'profile';
const permissionNames: Record<string, string> = {
  'staff.read': 'View team',
  'staff.manage': 'Manage staff',
  'roles.manage': 'Manage access',
  'locations.read': 'View locations',
  'audit.read': 'View activity history',
};
const canSeeTeam = (user: Profile) =>
  user.grants.some((grant) => grant.code === 'staff.read' && grant.locationId === null);

function Overview({
  user,
  ready,
  refresh,
  navigate,
}: {
  user: Profile;
  ready: boolean | null;
  refresh: () => void;
  navigate: (page: Page) => void;
}) {
  const global = user.grants.some((grant) => grant.locationId === null);
  const scopes = new Set(user.grants.map((grant) => grant.locationId).filter(Boolean)).size;
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Dhaka',
  }).format(new Date());
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1 id="page-title" tabIndex={-1}>
            Welcome, {user.displayName}.
          </h1>
          <p className="muted">A little more clarity. A lot more room to grow.</p>
        </div>
        <span className="date-label">{date}</span>
      </header>
      <div className="summary-grid">
        <section className="summary-card">
          <div className="summary-top">
            <span>Your access</span>
            <Icon name="lock" />
          </div>
          <strong>
            {global
              ? 'All locations'
              : scopes
                ? scopes + (scopes === 1 ? ' location' : ' locations')
                : 'Your profile'}
          </strong>
          <p>Access tailored to your responsibilities.</p>
        </section>
        <section className="summary-card">
          <div className="summary-top">
            <span>Workspace connection</span>
            <button className="icon-button" aria-label="Refresh workspace status" onClick={refresh}>
              <Icon name="refresh" />
            </button>
          </div>
          <strong className="connection-line">
            <span
              className={
                'status-dot ' +
                (ready === null ? 'status-neutral' : ready ? 'status-good' : 'status-warn')
              }
            />
            {ready === null ? 'Checking…' : ready ? 'Available' : 'Unavailable'}
          </strong>
          <p>
            {ready === false
              ? 'Try refreshing before making changes.'
              : 'Your private workspace, connected.'}
          </p>
        </section>
      </div>
      <div className="overview-grid">
        <section className="welcome-panel">
          <div className="panel-kicker">
            <span className="tiny-diamond" /> A SOLID START
          </div>
          <h2>
            Keep your people
            <br />
            <em>on the same page.</em>
          </h2>
          <p>
            Clear access. One place to sign in.
            <br />A foundation for your day-to-day business.
          </p>
          <button
            className="button button-cream"
            onClick={() => navigate(canSeeTeam(user) ? 'team' : 'profile')}
          >
            {canSeeTeam(user) ? 'View your team' : 'View your access'}
            <Icon name="arrow" />
          </button>
          <div className="welcome-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
        <section className="panel checklist-panel">
          <div className="section-header">
            <h2>Your account</h2>
            <span className="badge badge-green">Active</span>
          </div>
          <div className="checklist-row">
            <span className="check-circle">
              <Icon name="check" />
            </span>
            <div>
              <strong>Signed in</strong>
              <p>{user.username}</p>
            </div>
          </div>
          <div className="checklist-row">
            <span className="check-circle">
              <Icon name="check" />
            </span>
            <div>
              <strong>Personal password set</strong>
              <p>Your account is ready to use.</p>
            </div>
          </div>
          <div className="checklist-row">
            <span className="check-circle">
              <Icon name="check" />
            </span>
            <div>
              <strong>Access is assigned</strong>
              <p>
                {user.grants.length
                  ? 'Permissions follow your role and locations.'
                  : 'Your personal profile is available.'}
              </p>
            </div>
          </div>
          <button className="text-button" onClick={() => navigate('profile')}>
            Review your profile
            <Icon name="arrow" />
          </button>
        </section>
      </div>
      <section className="panel roadmap-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">GROWING WITH YOU</span>
            <h2>What comes next</h2>
          </div>
          <span className="muted small">The next chapters of your workspace</span>
        </div>
        <div className="roadmap-grid">
          <div>
            <span className="roadmap-number">01</span>
            <h3>Products & variants</h3>
            <p>Styles, sizes, colours and sellable items.</p>
            <span className="badge badge-outline">Planned</span>
          </div>
          <div>
            <span className="roadmap-number">02</span>
            <h3>Stock & locations</h3>
            <p>Receipts, transfers and a clear stock picture.</p>
            <span className="badge badge-outline">Planned</span>
          </div>
          <div>
            <span className="roadmap-number">03</span>
            <h3>Purchasing & sales</h3>
            <p>Connected suppliers, customers and payments.</p>
            <span className="badge badge-outline">Planned</span>
          </div>
        </div>
      </section>
    </>
  );
}

function Team({ api, user }: { api: StaffApi; user: Profile }) {
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

function ProfilePage({
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

export function Workspace({
  api,
  user,
  onSignedOut,
  onProfile,
}: {
  api: StaffApi;
  user: Profile;
  onSignedOut: (notice: string) => void;
  onProfile: (profile: Profile) => void;
}) {
  const [page, setPage] = useState<Page>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const check = () => {
      void api.ready().then((value) => {
        if (active) setReady(value);
      });
    };
    check();
    const interval = window.setInterval(check, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [api]);
  useEffect(() => {
    if (page === 'team' && !canSeeTeam(user)) setPage('overview');
  }, [page, user]);
  useEffect(() => {
    document.getElementById('page-title')?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const changed = () => {
      if (!media.matches) setMenuOpen(false);
    };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    const buttons = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar button:not(:disabled)'));
    buttons()[0]?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        trigger?.focus();
      }
      if (event.key === 'Tab') {
        const items = buttons();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (document.activeElement?.closest('.sidebar')) trigger?.focus();
    };
  }, [menuOpen]);
  function navigate(next: Page) {
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await api.logout();
      onSignedOut('You have signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label="Workspace navigation"
        className={'sidebar' + (menuOpen ? ' sidebar-open' : '')}
      >
        <Brand />
        <button
          className="icon-button sidebar-close"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        >
          <Icon name="close" />
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            aria-current={page === 'overview' ? 'page' : undefined}
            className={page === 'overview' ? 'nav-active' : ''}
            onClick={() => navigate('overview')}
          >
            <Icon name="overview" />
            Overview
          </button>
          {canSeeTeam(user) && (
            <button
              aria-current={page === 'team' ? 'page' : undefined}
              className={page === 'team' ? 'nav-active' : ''}
              onClick={() => navigate('team')}
            >
              <Icon name="team" />
              Team
            </button>
          )}
          <button
            aria-current={page === 'profile' ? 'page' : undefined}
            className={page === 'profile' ? 'nav-active' : ''}
            onClick={() => navigate('profile')}
          >
            <Icon name="profile" />
            My profile
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="tiny-diamond" />
          <p>
            Built to grow
            <br />
            with your business.
          </p>
          <span className="small">One connected workspace.</span>
        </div>
        <div className="sidebar-account">
          <span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{user.displayName}</strong>
            <small>Staff workspace</small>
          </span>
        </div>
        <button className="sign-out-button" onClick={() => void logout()} disabled={busy}>
          <Icon name="logout" />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {page === 'profile' ? 'My profile' : page === 'team' ? 'Team' : 'Overview'}
            </strong>
          </div>
          <button
            className="topbar-user"
            onClick={() => navigate('profile')}
            aria-label="Open my profile"
          >
            <span className="private-label">
              <Icon name="lock" />
              Private workspace
            </span>
            <span className="avatar avatar-small">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
          </button>
        </header>
        <main className="main-content" id="main-content" tabIndex={-1}>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {page === 'overview' && (
            <Overview
              user={user}
              ready={ready}
              refresh={() => {
                setReady(null);
                void api.ready().then(setReady);
              }}
              navigate={navigate}
            />
          )}
          {page === 'team' && <Team api={api} user={user} />}
          {page === 'profile' && (
            <ProfilePage
              api={api}
              user={user}
              onSignedOut={onSignedOut}
              onRefresh={async () => onProfile(await api.me())}
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>Commerce workspace</span>
          <span>Considered. Connected. Yours.</span>
        </footer>
      </div>
    </div>
  );
}
