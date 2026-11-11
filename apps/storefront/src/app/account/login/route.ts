import type { NextRequest } from 'next/server';
import {
  accountJson,
  accountFailure,
  browserWrite,
  accountBody,
  customerLogin,
  setCustomerCookie,
} from '../../../lib/account-server';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    browserWrite(req);
    const token = await customerLogin(await accountBody(req));
    return setCustomerCookie(accountJson({ status: 'ok' }), token);
  } catch (e) {
    return accountFailure(e);
  }
}
