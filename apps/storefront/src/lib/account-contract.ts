export type CustomerAccount = { displayName: string; email: string };
export function customerCookieName(site: string) {
  const u = new URL(site);
  return u.protocol === 'https:'
    ? '__Host-commerce_customer_session'
    : 'commerce_customer_session_' + (u.port || '80');
}
export function accountSession(v: unknown): {
  account: CustomerAccount;
  expiresAt: string;
  csrfToken: string;
} {
  if (!v || typeof v !== 'object') throw Error('Invalid account response');
  const x = v as Record<string, unknown>,
    a = x.account as Record<string, unknown> | undefined;
  if (
    !a ||
    typeof a.displayName !== 'string' ||
    a.displayName.length < 1 ||
    a.displayName.length > 120 ||
    typeof a.email !== 'string' ||
    a.email.length > 254 ||
    typeof x.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(x.expiresAt)) ||
    typeof x.csrfToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(x.csrfToken)
  )
    throw Error('Invalid account response');
  return {
    account: { displayName: a.displayName, email: a.email },
    expiresAt: x.expiresAt,
    csrfToken: x.csrfToken,
  };
}
export function accountToken(v: unknown) {
  if (
    !v ||
    typeof v !== 'object' ||
    !('token' in v) ||
    typeof v.token !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(v.token)
  )
    throw Error('Invalid account response');
  return v.token;
}

export type AccountView =
  | { state: 'closed' | 'signed-out' }
  | { state: 'signed-in'; account: CustomerAccount; expiresAt: string };
export function accountView(v: unknown): AccountView {
  if (!v || typeof v !== 'object' || !('state' in v)) throw Error('Invalid account view');
  if (v.state === 'closed' || v.state === 'signed-out') return { state: v.state };
  if (v.state !== 'signed-in' || !('account' in v) || !('expiresAt' in v))
    throw Error('Invalid account view');
  const parsed = accountSession({
    account: v.account,
    expiresAt: v.expiresAt,
    csrfToken: '0'.repeat(64),
  });
  return { state: 'signed-in', account: parsed.account, expiresAt: parsed.expiresAt };
}
