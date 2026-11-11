import type { NextRequest } from 'next/server';
import {
  accountJson,
  accountFailure,
  browserWrite,
  accountBody,
  browserToken,
  customerLogout,
  setCustomerCookie,
  CustomerError,
} from '../../../lib/account-server';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    browserWrite(req);
    const body = await accountBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
      throw new CustomerError(400, 'INVALID_CUSTOMER_QUERY');
    await customerLogout(browserToken(req));
    return setCustomerCookie(accountJson({ status: 'ok' }), null);
  } catch (e) {
    return accountFailure(e);
  }
}
