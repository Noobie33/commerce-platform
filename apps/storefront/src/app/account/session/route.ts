import type { NextRequest } from 'next/server';
import {
  accountJson,
  accountFailure,
  CustomerError,
  browserToken,
  customerMode,
  customerSession,
  setCustomerCookie,
} from '../../../lib/account-server';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    if (new URL(req.url).search) throw new CustomerError(400, 'INVALID_CUSTOMER_QUERY');
    if ((await customerMode()) === 'closed') return accountJson({ state: 'closed' });
    const token = browserToken(req);
    if (!token) return accountJson({ state: 'signed-out' });
    try {
      const v = await customerSession(token);
      return accountJson({ state: 'signed-in', account: v.account, expiresAt: v.expiresAt });
    } catch (e) {
      if (e instanceof CustomerError && e.status === 401)
        return setCustomerCookie(accountJson({ state: 'signed-out' }), null);
      throw e;
    }
  } catch (e) {
    return accountFailure(e);
  }
}
