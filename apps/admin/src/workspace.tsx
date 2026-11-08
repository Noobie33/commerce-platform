import { useEffect, useState } from 'react';
import { StaffApi } from './api';
import { Brand, Icon } from './icons';
import type { Profile, WorkspacePage as Page } from './types';
import { canSeeTeam, canSeeCatalog, hasGlobal } from './access';
import { Overview } from './pages/overview';
import { Team } from './pages/team';
import { ProfilePage } from './pages/profile';
import { CatalogPage } from './catalog/catalog-page';
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
  const parsePage = (): Page => {
    const value = window.location.hash.slice(1);
    return ['overview', 'catalog', 'team', 'profile'].includes(value)
      ? (value as Page)
      : 'overview';
  };
  const [page, setPage] = useState<Page>(parsePage);
  useEffect(() => {
    const changed = () => {
      if (['overview', 'catalog', 'team', 'profile'].includes(window.location.hash.slice(1)))
        setPage(parsePage());
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 980px)').matches);
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
    if ((page === 'team' && !canSeeTeam(user)) || (page === 'catalog' && !canSeeCatalog(user))) {
      setPage('overview');
      window.history.replaceState(null, '', '#overview');
    }
  }, [page, user]);
  useEffect(() => {
    document.getElementById('page-title')?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const changed = () => {
      setCompact(media.matches);
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
    window.location.hash = next;
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
        inert={compact && !menuOpen}
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
          {canSeeCatalog(user) && (
            <button
              aria-current={page === 'catalog' ? 'page' : undefined}
              className={page === 'catalog' ? 'nav-active' : ''}
              onClick={() => navigate('catalog')}
            >
              <Icon name="catalog" />
              Catalog
            </button>
          )}
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
              {page === 'profile'
                ? 'My profile'
                : page === 'team'
                  ? 'Team'
                  : page === 'catalog'
                    ? 'Catalog'
                    : 'Overview'}
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
          {page === 'catalog' && canSeeCatalog(user) && (
            <CatalogPage api={api} canManage={hasGlobal(user, 'catalog.manage')} />
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
