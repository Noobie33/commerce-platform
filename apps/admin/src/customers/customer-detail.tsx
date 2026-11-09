import { useEffect, useState } from 'react';
import { StaffApi } from '../api';
import { Dialog } from '../components/dialog';
import type { Customer, CreditHistory } from './types';
import { creditMoney, minorMoney, errorText } from './helpers';
export function CustomerDetail({
  api,
  customer: c,
  canManage,
  canReadLegacyCredit,
  close,
  edit,
}: {
  api: StaffApi;
  customer: Customer;
  canManage: boolean;
  canReadLegacyCredit: boolean;
  close: () => void;
  edit: () => void;
}) {
  const [history, setHistory] = useState<CreditHistory | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!canReadLegacyCredit) return;
    let live = true;
    setHistory(null);
    setError('');
    void api
      .customerCreditHistory(c.id, page)
      .then((h) => {
        if (live) setHistory(h);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [api, c.id, canReadLegacyCredit, page, retry]);
  return (
    <Dialog title={c.name} subtitle={c.code + ' · Version ' + c.version} onClose={close} wide>
      <div className="customer-dialog-body">
        <div className="customer-facts">
          <div>
            <span>Customer type</span>
            <strong>
              {c.customerKind}
              {c.segment !== 'retail' ? ' / Archived trade profile' : ''}
            </strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{c.isActive ? 'Active' : 'Inactive'}</strong>
          </div>
          <div>
            <span>Contact person</span>
            <strong>{c.contactName || 'Not provided'}</strong>
          </div>
          <div>
            <span>Phone</span>
            <strong>{c.phone || 'Not provided'}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{c.email || 'Not provided'}</strong>
          </div>
          {canReadLegacyCredit && c.creditEnabled && (
            <div>
              <span>Archived trade policy (inactive)</span>
              <strong>
                {c.creditEnabled
                  ? creditMoney(c.creditLimit) + ' · ' + c.paymentTermsDays + ' day terms'
                  : 'Disabled'}
              </strong>
            </div>
          )}
        </div>
        <div className="customer-address-grid">
          {(['billingAddress', 'deliveryAddress'] as const).map((key) => (
            <section key={key}>
              <h3>{key === 'billingAddress' ? 'Billing address' : 'Delivery address'}</h3>
              {c[key] ? (
                <p>
                  {(['line1', 'line2', 'area', 'district', 'postalCode'] as const)
                    .map((field) => c[key]![field])
                    .filter(Boolean)
                    .join(', ')}
                  <br />
                  Bangladesh
                </p>
              ) : (
                <p>Not provided</p>
              )}
            </section>
          ))}
        </div>
        {c.notes && (
          <section>
            <h3>Internal notes</h3>
            <p className="customer-prewrap">{c.notes}</p>
          </section>
        )}
        {canReadLegacyCredit && (error || (history?.total ?? 0) > 0) && (
          <section>
            <h3>Archived trade policy history</h3>
            <p>Read-only history. Customer trade credit is no longer offered.</p>
            {error ? (
              <p role="alert" className="form-error">
                {error}{' '}
                <button className="secondary-button" onClick={() => setRetry((n) => n + 1)}>
                  Retry history
                </button>
              </p>
            ) : !history ? (
              <p role="status">Loading history…</p>
            ) : history.items.length === 0 ? (
              <p>No credit policy changes recorded.</p>
            ) : (
              history.items.map((h) => (
                <article className="customer-history" key={h.id}>
                  <strong>
                    {h.currentPolicy.creditEnabled
                      ? 'Enabled · ' +
                        minorMoney(h.currentPolicy.creditLimitMinor) +
                        ' · ' +
                        h.currentPolicy.paymentTermsDays +
                        ' day terms'
                      : 'Credit disabled'}
                  </strong>
                  <p>{h.reason}</p>
                  <small>
                    {h.actorName} ·{' '}
                    {new Date(h.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}{' '}
                    (Dhaka) · v{h.version}
                  </small>
                  <small>
                    Previous:{' '}
                    {h.previousPolicy.creditEnabled
                      ? minorMoney(h.previousPolicy.creditLimitMinor) +
                        ' · ' +
                        h.previousPolicy.paymentTermsDays +
                        ' days'
                      : 'Disabled'}
                  </small>
                </article>
              ))
            )}
            {history && history.total > 20 && (
              <div className="customer-pagination">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous history
                </button>
                <span>Page {page}</span>
                <button disabled={page * 20 >= history.total} onClick={() => setPage((p) => p + 1)}>
                  Next history
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      <footer className="dialog-footer customer-actions">
        <button className="secondary-button" onClick={close}>
          Close
        </button>
        {canManage && (
          <button className="primary-button" onClick={edit}>
            Edit customer
          </button>
        )}
      </footer>
    </Dialog>
  );
}
