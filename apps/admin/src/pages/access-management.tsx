import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import { useLiveRead } from '../data/use-live-read';
import { ReadStatus } from '../data/read-status';
import type {
  AccessInput,
  AccessKind,
  AccessRecord,
  AccessChoice,
  AccessView,
} from './access-types';
import '../catalog/content.css';
import './access-management.css';
const label = (s: string) =>
  s
    .split(/[._]/)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
function Choices({
  api,
  kind,
  onChoose,
}: {
  api: StaffApi;
  kind: string;
  onChoose: (v: AccessChoice) => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [data, setData] = useState<Awaited<ReturnType<StaffApi['accessChoices']>> | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        void api
          .accessChoices(kind, search, page)
          .then((x) => {
            if (live) {
              setData(x);
              setError('');
            }
          })
          .catch((e) => {
            if (live) setError(e instanceof Error ? e.message : 'Choices unavailable');
          }),
      200,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, kind, search, page]);
  return (
    <section className="access-choices">
      <label>
        Find {kind}
        <input
          type="search"
          maxLength={120}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((v) => (
        <button type="button" className="secondary-button" key={v.id} onClick={() => onChoose(v)}>
          {v.label}
        </button>
      ))}
      {data?.items.length === 0 && <p>No available {kind}.</p>}
      <div className="merch-actions">
        <button type="button" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
          Previous {kind}
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          disabled={!data || page * 20 >= data.total}
          onClick={() => setPage((n) => n + 1)}
        >
          Next {kind}
        </button>
      </div>
    </section>
  );
}
export function AccessManagement({ api, close }: { api: StaffApi; close: () => void }) {
  const [kind, setKind] = useState<AccessKind>('staff'),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [selected, setSelected] = useState<AccessView | null>(null),
    [edit, setEdit] = useState<AccessInput | null>(null),
    [initial, setInitial] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [policy, setPolicy] = useState<{ code: string; locationScope: boolean }[]>([]),
    [chosen, setChosen] = useState<AccessChoice | null>(null),
    [scope, setScope] = useState<'global' | 'location'>('location'),
    [location, setLocation] = useState<AccessChoice | null>(null),
    [names, setNames] = useState<Record<string, string>>({});
  const retry = useRef<{ body: string; key: string } | null>(null),
    ticket = useRef(0),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = !!edit && JSON.stringify(edit) !== initial;
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    let active = true;
    void api
      .accessPolicy()
      .then((p) => {
        if (active) setPolicy(p);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load permission policy');
      });
    return () => {
      active = false;
      ticket.current++;
    };
  }, [api]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const read = useLiveRead(
    useCallback((options) => api.accessList(kind, query, page, options), [api, kind, query, page]),
    { topics: ['team'], allowInDialog: true, paused: !!edit || !!selected, revision },
  );
  useEffect(() => {
    if (read.data && page > Math.max(1, Math.ceil(read.data.total / 20)))
      setPage(Math.max(1, Math.ceil(read.data.total / 20)));
  }, [read.data, page]);
  const dismiss = () => {
    if (!busy && (!dirty || window.confirm('Discard unsaved access changes?'))) close();
  };
  async function open(id: string, historyPage = 1) {
    const seq = ++ticket.current;
    setError('');
    try {
      const value = await api.accessRead(kind, id, historyPage);
      if (seq === ticket.current) {
        setSelected(value);
        setNames((n) => ({
          ...n,
          ...Object.fromEntries(
            (value.record.assignments ?? []).flatMap((a) => [
              [a.roleId, a.roleLabel ?? a.roleId],
              ...(a.locationId ? [[a.locationId, a.locationLabel ?? a.locationId]] : []),
            ]),
          ),
        }));
      }
    } catch (e) {
      if (seq === ticket.current)
        setError(e instanceof Error ? e.message : 'Unable to load access record');
    }
  }
  function begin(r: AccessRecord) {
    ticket.current++;
    const input: AccessInput = {
      kind,
      id: r.id,
      expectedVersion: r.version,
      active: r.active,
      reason: '',
      ...(kind === 'staff'
        ? {
            displayName: r.displayName ?? '',
            assignments:
              r.assignments?.map((a) => ({ roleId: a.roleId, locationId: a.locationId })) ?? [],
          }
        : { code: r.code ?? '', label: r.label ?? '', permissions: [...(r.permissions ?? [])] }),
    };
    setEdit(input);
    setInitial(JSON.stringify(input));
    setError('');
    setChosen(null);
    setLocation(null);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || busy) return;
    const body = JSON.stringify(edit);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    let saved = false;
    try {
      const result = await api.saveAccess(edit, retry.current.key);
      saved = true;
      setEdit(null);
      refresh((n) => n + 1);
      await open(result.id);
      setNotice(
        'Change saved. ' +
          result.revokedSessions +
          ' existing session(s) revoked where access changed.',
      );
    } catch (e) {
      setError(
        saved
          ? 'Saved. Reopen this record to see its current state.'
          : e instanceof Error
            ? e.message
            : 'Unable to save access change.',
      );
    } finally {
      setBusy(false);
    }
  }
  const roleNames = Object.fromEntries(
    (read.data?.items ?? []).filter((r) => r.code).map((r) => [r.id, r.label ?? r.code ?? r.id]),
  );
  return (
    <Dialog
      title="Team access management"
      subtitle="Owner-controlled roles, location access and staff status"
      wide
      onClose={dismiss}
    >
      <div className="product-content-body access-management">
        <p className="content-boundary">
          Owner access is protected here. Access changes are audited and close affected sessions.
          New-account onboarding and password recovery are separate upcoming work.
        </p>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {(error || read.error) && (
          <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error || read.error}
          </p>
        )}
        {edit ? (
          <form onSubmit={save}>
            <fieldset className="content-fields" disabled={busy}>
              {edit.kind === 'role' ? (
                <>
                  <label>
                    Role name
                    <input
                      required
                      maxLength={120}
                      value={edit.label}
                      onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                    />
                  </label>
                </>
              ) : (
                <label>
                  Staff display name
                  <input
                    required
                    maxLength={120}
                    value={edit.displayName}
                    onChange={(e) => setEdit({ ...edit, displayName: e.target.value })}
                  />
                </label>
              )}
              <label className="access-check">
                <input
                  type="checkbox"
                  checked={edit.active}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      active: e.target.checked,
                      ...(edit.kind === 'role' && !e.target.checked ? { permissions: [] } : {}),
                    })
                  }
                />
                {edit.kind === 'role' ? 'Active role' : 'Active staff account'}
              </label>
            </fieldset>
            {edit.kind === 'role' ? (
              <section className="content-readiness">
                <h3>Permissions</h3>
                <p>
                  This role is assigned to {selected?.record.assignedStaffCount ?? 0} staff
                  account(s). Changing its permissions signs out affected non-owner staff.
                </p>
                <p>
                  Select only the actions this team needs. Read access and write actions can be
                  combined through several roles. A role can be assigned to one location only when
                  every selected permission supports it.
                </p>
                <div className="access-permissions">
                  {policy.map((p) => (
                    <label key={p.code}>
                      <input
                        type="checkbox"
                        disabled={busy || !edit.active}
                        checked={edit.permissions?.includes(p.code) ?? false}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            permissions: e.target.checked
                              ? [...(edit.permissions ?? []), p.code].sort()
                              : (edit.permissions?.filter((c) => c !== p.code) ?? []),
                          })
                        }
                      />
                      <span>
                        {label(p.code)}
                        <small>
                          {p.locationScope
                            ? 'Location access supported'
                            : 'Company-wide permission'}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ) : (
              <section className="content-readiness">
                <h3>Assigned roles</h3>
                {edit.assignments?.map((a, i) => (
                  <div className="access-assignment" key={a.roleId + '-' + a.locationId}>
                    <span>
                      {names[a.roleId] ?? roleNames[a.roleId] ?? a.roleId} /{' '}
                      {a.locationId
                        ? (names[a.locationId] ?? a.locationId)
                        : 'Company-wide / all locations'}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setEdit({
                          ...edit,
                          assignments: edit.assignments?.filter((_, j) => j !== i) ?? [],
                        })
                      }
                    >
                      Remove assignment
                    </button>
                  </div>
                ))}
                {!edit.assignments?.length && (
                  <p>No business roles. This account has no operational permissions.</p>
                )}
                <fieldset disabled={busy}>
                  <legend>Add a role assignment</legend>
                  <Choices
                    api={api}
                    kind="roles"
                    onChoose={(r) => {
                      setChosen(r);
                      setLocation(null);
                      setScope(r.locationCompatible ? 'location' : 'global');
                      setNames((n) => ({ ...n, [r.id]: r.label }));
                    }}
                  />
                  {chosen && (
                    <>
                      <p>
                        Selected role: <strong>{chosen.label}</strong>
                      </p>
                      {!chosen.locationCompatible && (
                        <p>This role applies company-wide, across all locations.</p>
                      )}
                      {chosen.locationCompatible && (
                        <label>
                          Access scope
                          <select
                            value={scope}
                            onChange={(e) => setScope(e.target.value as 'global' | 'location')}
                          >
                            <option value="location">One selected location</option>
                            <option value="global">Company-wide / all locations</option>
                          </select>
                        </label>
                      )}
                      {scope === 'location' && (
                        <>
                          <Choices
                            api={api}
                            kind="locations"
                            onChoose={(l) => {
                              setLocation(l);
                              setNames((n) => ({ ...n, [l.id]: l.label }));
                            }}
                          />
                          <p>Selected location: {location?.label ?? 'Choose a location'}</p>
                        </>
                      )}
                      <button
                        type="button"
                        disabled={
                          busy ||
                          (scope === 'location' && !location) ||
                          (edit.assignments?.length ?? 0) >= 20
                        }
                        onClick={() => {
                          const a = {
                            roleId: chosen.id,
                            locationId: scope === 'global' ? null : location!.id,
                          };
                          if (
                            edit.assignments?.some(
                              (x) => x.roleId === a.roleId && x.locationId === a.locationId,
                            )
                          ) {
                            setError('This role and scope are already assigned.');
                            return;
                          }
                          setEdit({ ...edit, assignments: [...(edit.assignments ?? []), a] });
                          setChosen(null);
                        }}
                      >
                        Add selected assignment
                      </button>
                    </>
                  )}
                </fieldset>
              </section>
            )}
            <fieldset className="content-fields" disabled={busy}>
              <label>
                Reason for this change
                <textarea
                  required
                  maxLength={500}
                  value={edit.reason}
                  onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                />
              </label>
            </fieldset>
            <div className="merch-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  if (!dirty || window.confirm('Discard unsaved access changes?')) setEdit(null);
                }}
              >
                Cancel editing
              </button>
              <button className="primary-button" disabled={busy || !dirty || !policy.length}>
                Save access revision
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="merch-actions">
              <button
                aria-pressed={kind === 'staff'}
                onClick={() => {
                  setKind('staff');
                  setSelected(null);
                  setSearch('');
                  setPage(1);
                  ticket.current++;
                }}
              >
                Staff access
              </button>
              <button
                aria-pressed={kind === 'role'}
                onClick={() => {
                  setKind('role');
                  setSelected(null);
                  setSearch('');
                  setPage(1);
                  ticket.current++;
                }}
              >
                Roles
              </button>
              {kind === 'role' && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setSelected(null);
                    begin({
                      id: crypto.randomUUID(),
                      version: 0,
                      code: 'role_' + crypto.randomUUID().replaceAll('-', ''),
                      label: '',
                      active: true,
                      permissions: [],
                      protected: false,
                    });
                  }}
                >
                  Create role
                </button>
              )}
            </div>
            <ReadStatus read={read} />
            <label>
              Search {kind === 'staff' ? 'staff' : 'roles'}
              <input
                type="search"
                maxLength={120}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {read.data?.items.map((r) => (
              <button className="access-record" key={r.id} onClick={() => void open(r.id)}>
                <strong>{r.displayName ?? r.label}</strong>
                <span>
                  {r.username ? r.username + ' / ' : ''} {r.active ? 'Active' : 'Inactive'} /
                  revision {r.version}
                  {r.protected ? ' / Protected' : ''}
                </span>
              </button>
            ))}
            {read.data?.items.length === 0 && <p>No matching records.</p>}
            <div className="merch-actions">
              <button
                disabled={page === 1}
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n - 1);
                }}
              >
                Previous records
              </button>
              <span>
                Page {page} / {read.data?.total ?? 0} records
              </span>
              <button
                disabled={page * 20 >= (read.data?.total ?? 0)}
                onClick={() => {
                  setSelected(null);
                  setPage((n) => n + 1);
                }}
              >
                Next records
              </button>
            </div>
            {selected && (
              <section className="content-history">
                <h3>{selected.record.displayName ?? selected.record.label}</h3>
                {selected.record.protected ? (
                  <p>
                    Protected owner or reserved administrative access. This screen cannot change it.
                  </p>
                ) : (
                  <button className="secondary-button" onClick={() => begin(selected.record)}>
                    Edit {kind === 'staff' ? 'staff access' : 'role'}
                  </button>
                )}
                {selected.record.permissions && (
                  <p>{selected.record.permissions.map(label).join(', ') || 'No permissions'}</p>
                )}
                {selected.record.assignments?.map((a) => (
                  <p key={a.roleId + '-' + a.locationId}>
                    Role {names[a.roleId] ?? a.roleId} /{' '}
                    {a.locationId
                      ? (a.locationLabel ?? names[a.locationId] ?? a.locationId)
                      : 'Company-wide / all locations'}
                  </p>
                ))}
                <h4>Immutable change history</h4>
                {!selected.history.length && <p>No managed revisions yet.</p>}
                {selected.history.map((h) => (
                  <details key={h.version}>
                    <summary>
                      Revision {h.version} / {h.actorName}
                    </summary>
                    <p>{h.reason}</p>
                    <p>
                      {h.revokedSessions} session(s) revoked /{' '}
                      {new Date(h.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}{' '}
                      (Dhaka)
                    </p>
                    <p>
                      Name: {h.snapshot.displayName ?? h.snapshot.label} /{' '}
                      {h.snapshot.active ? 'Active' : 'Inactive'}
                    </p>
                    {h.snapshot.permissions && (
                      <p>Permissions: {h.snapshot.permissions.map(label).join(', ') || 'None'}</p>
                    )}
                    {h.snapshot.assignments && (
                      <p>Assigned roles: {h.snapshot.assignments.length}</p>
                    )}
                  </details>
                ))}
                <div className="merch-actions">
                  <button
                    disabled={selected.page === 1}
                    onClick={() => void open(selected.record.id, selected.page - 1)}
                  >
                    Newer access history
                  </button>
                  <button
                    disabled={!selected.hasMore}
                    onClick={() => void open(selected.record.id, selected.page + 1)}
                  >
                    Older access history
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
