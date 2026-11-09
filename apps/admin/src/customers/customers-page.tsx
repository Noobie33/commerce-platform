import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import type { Customer, CustomerPage } from './types';
import { errorText } from './helpers';
import { CustomerDetail } from './customer-detail';
import { CustomerEditor } from './customer-editor';
import './customers.css';
export function CustomersPage({
  api,
  canManage,
  canReadLegacyCredit,
}: {
  api: StaffApi;
  canManage: boolean;
  canReadLegacyCredit: boolean;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('active'),
    [kind, setKind] = useState('all'),
    [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [data, setData] = useState<CustomerPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [detail, setDetail] = useState<Customer | null>(null),
    [editor, setEditor] = useState<Customer | 'new' | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void api
      .customers({ search: query, status, kind, page })
      .then((value) => {
        if (live) {
          setData(value);
          if (page > 1 && !value.items.length) setPage(Math.max(1, Math.ceil(value.total / 20)));
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, query, status, kind, page, revision]);
  async function open(id: string) {
    setError('');
    try {
      setDetail(await api.customer(id));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function saved(result: { id: string }, message: string) {
    setEditor(null);
    setNotice(message);
    refresh((n) => n + 1);
    await open(result.id);
  }
  return (
    <section className="customers-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RELATIONSHIPS</span>
          <h1 id="page-title" tabIndex={-1}>
            Customers
          </h1>
          <p>Customer contacts and addresses for your retail brand.</p>
        </div>
        <div className="customer-header-actions">
          <button
            className="secondary-button"
            onClick={() => refresh((n) => n + 1)}
            disabled={loading}
          >
            Refresh
          </button>
          {canManage && (
            <button className="primary-button" onClick={() => setEditor('new')}>
              + New customer
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p className="customer-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button className="secondary-button" onClick={() => refresh((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      <div className="customer-toolbar">
        <label>
          Search customers
          <input
            value={search}
            maxLength={140}
            placeholder="Name, code, phone or email"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <label>
          Customer type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All types</option>
            <option value="person">Person</option>
            <option value="business">Business</option>
          </select>
        </label>
      </div>
      <div className="customer-panel" aria-busy={loading}>
        <div className="customer-panel-heading">
          <h2>Customer directory</h2>
          <span>{loading ? 'Loading…' : `${data?.total ?? 0} matching records`}</span>
        </div>
        {!loading && !error && data?.items.length === 0 ? (
          <div className="customer-empty">
            <h3>{query ? 'No matching customers' : 'No customers in this view'}</h3>
            <p>
              {query
                ? 'Try a different search or filter.'
                : 'Add a customer to start a shared record for your team.'}
            </p>
          </div>
        ) : (
          <div className="customer-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <button className="customer-link" onClick={() => void open(c.id)}>
                        {c.name}
                      </button>
                      <small>
                        {c.code} · {c.customerKind === 'business' ? 'Business' : 'Person'}
                      </small>
                    </td>
                    <td>
                      {c.phone || c.email || 'Not provided'}
                      {c.phone && c.email && <small>{c.email}</small>}
                    </td>
                    <td>
                      <span className={'customer-badge ' + (c.isActive ? 'active' : '')}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="customer-pagination">
          <span>
            Page {page} of {Math.max(1, Math.ceil((data?.total ?? 0) / 20))}
          </span>
          <div>
            <button
              className="secondary-button"
              disabled={loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="secondary-button"
              disabled={loading || page * 20 >= (data?.total ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      {detail && (
        <CustomerDetail
          api={api}
          customer={detail}
          canManage={canManage && detail.segment === 'retail'}
          canReadLegacyCredit={canReadLegacyCredit}
          close={() => setDetail(null)}
          edit={() => {
            setEditor(detail);
            setDetail(null);
          }}
        />
      )}
      {editor && (
        <CustomerEditor
          api={api}
          initial={editor === 'new' ? null : editor}
          close={() => setEditor(null)}
          saved={(r) => void saved(r, 'Customer saved.')}
        />
      )}
    </section>
  );
}
