import 'server-only';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { storeSettings } from './catalog-api';
import { customerCookieName, accountSession, accountToken } from './account-contract';
export class CustomerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Customer account request failed');
  }
}
const headers = { 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' };
export function accountJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers });
}
export function accountFailure(e: unknown) {
  return accountJson(
    { code: e instanceof CustomerError ? e.code : 'CUSTOMER_UNAVAILABLE' },
    e instanceof CustomerError ? e.status : 503,
  );
}
export function browserToken(req: NextRequest) {
  const values = req.cookies.getAll(customerCookieName(storeSettings().site));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]!.value)
    ? values[0]!.value
    : undefined;
}
export function setCustomerCookie(r: NextResponse, token: string | null) {
  const site = storeSettings().site;
  r.cookies.set(customerCookieName(site), token ?? '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(site).protocol === 'https:',
    path: '/',
    maxAge: token ? 8 * 60 * 60 : 0,
  });
  return r;
}
export function browserWrite(req: NextRequest) {
  if (
    new URL(req.url).search ||
    req.headers.get('origin') !== storeSettings().site ||
    req.headers.get('x-requested-with') !== 'commerce-store' ||
    req.headers.get('sec-fetch-site') === 'cross-site' ||
    !/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')
  )
    throw new CustomerError(403, 'CUSTOMER_REQUEST_DENIED');
}
export async function accountBody(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new CustomerError(400, 'INVALID_CUSTOMER_LOGIN');
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  try {
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 8192) {
        await reader.cancel();
        throw new CustomerError(413, 'CUSTOMER_REQUEST_TOO_LARGE');
      }
      parts.push(r.value);
    }
    if (timedOut) throw new CustomerError(408, 'CUSTOMER_REQUEST_TIMEOUT');
    const out = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(out)) as unknown;
    } catch {
      throw new CustomerError(400, 'INVALID_CUSTOMER_LOGIN');
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
async function api(
  path: 'status' | 'login' | 'session' | 'logout',
  token?: string,
  body?: unknown,
  csrf?: string,
) {
  const origin = storeSettings().origin;
  let r: Response;
  try {
    r = await fetch(origin + '/api/v1/store/account/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        ...(token ? { 'X-Customer-Session': token } : {}),
        ...(csrf ? { 'X-Customer-Csrf': csrf } : {}),
        ...(body === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
              Origin: origin,
              'X-Requested-With': 'commerce-store-server',
            }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new CustomerError(503, 'CUSTOMER_UNAVAILABLE');
  }
  if (!r.ok) {
    await r.body?.cancel();
    const allowed = [400, 401, 403, 429, 503].includes(r.status) ? r.status : 503;
    throw new CustomerError(
      allowed,
      (
        {
          400: 'INVALID_CUSTOMER_LOGIN',
          401: 'CUSTOMER_INVALID_CREDENTIALS',
          403: 'CUSTOMER_REQUEST_DENIED',
          429: 'CUSTOMER_LOGIN_THROTTLED',
          503: 'CUSTOMER_UNAVAILABLE',
        } as Record<number, string>
      )[allowed]!,
    );
  }
  if (
    !r.headers.get('content-type')?.startsWith('application/json') ||
    r.headers.get('content-encoding')
  )
    throw new CustomerError(503, 'CUSTOMER_UNAVAILABLE');
  const reader = r.body?.getReader();
  if (!reader) throw new CustomerError(503, 'CUSTOMER_UNAVAILABLE');
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const v = await reader.read();
      if (v.done) break;
      size += v.value.length;
      if (size > 8192) {
        await reader.cancel();
        throw new CustomerError(503, 'CUSTOMER_UNAVAILABLE');
      }
      chunks.push(v.value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return JSON.parse(new TextDecoder().decode(out)) as unknown;
  } finally {
    reader.releaseLock();
  }
}
export async function customerMode() {
  const v = await api('status');
  if (
    !v ||
    typeof v !== 'object' ||
    !('mode' in v) ||
    !['closed', 'preview'].includes(String(v.mode))
  )
    throw new CustomerError(503, 'CUSTOMER_UNAVAILABLE');
  return v.mode;
}
export async function customerLogin(body: unknown) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 2 ||
    !('email' in body) ||
    !('password' in body) ||
    typeof body.email !== 'string' ||
    body.email.length > 254 ||
    typeof body.password !== 'string' ||
    body.password.length > 512
  )
    throw new CustomerError(400, 'INVALID_CUSTOMER_LOGIN');
  return accountToken(
    await api('login', undefined, { email: body.email, password: body.password }),
  );
}
export async function customerSession(token: string | undefined) {
  return accountSession(await api('session', token));
}
export async function customerLogout(token: string | undefined) {
  try {
    const session = await customerSession(token);
    await api('logout', token, {}, session.csrfToken);
  } catch (e) {
    if (e instanceof CustomerError && e.status === 401) return;
    throw e;
  }
}
