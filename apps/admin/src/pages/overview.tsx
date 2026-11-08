import { Icon } from '../icons';
import { canSeeTeam, canSeeCatalog, canSeeInventory } from '../access';
import type { Profile, WorkspacePage as Page } from '../types';
export function Overview({
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
            onClick={() =>
              navigate(canSeeCatalog(user) ? 'catalog' : canSeeTeam(user) ? 'team' : 'profile')
            }
          >
            {canSeeCatalog(user)
              ? 'Explore your collection'
              : canSeeTeam(user)
                ? 'View your team'
                : 'View your access'}
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
            {canSeeCatalog(user) ? (
              <button className="text-button" onClick={() => navigate('catalog')}>
                Open catalog <Icon name="arrow" />
              </button>
            ) : (
              <span className="badge badge-outline">Ask for access</span>
            )}
          </div>
          <div>
            <span className="roadmap-number">02</span>
            <h3>Stock & locations</h3>
            <p>Receipts, transfers and a clear stock picture.</p>
            {canSeeInventory(user) ? (
              <button className="text-button" onClick={() => navigate('inventory')}>
                Open inventory <Icon name="arrow" />
              </button>
            ) : (
              <span className="badge badge-outline">Ask for access</span>
            )}
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
