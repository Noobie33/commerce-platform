import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { PasswordService } from '../identity/password.service.js';
import { tokenHash } from '../identity/identity.service.js';
import { customerToken } from './account.validation.js';
type Account = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
};
type Session = Account & { session_id: string; csrf_token: string; expires_at: Date };
export class StoreAccountService {
  constructor(
    private readonly db: DataSource,
    private readonly passwords: PasswordService,
    readonly mode: 'closed' | 'preview',
  ) {}
  private open() {
    if (this.mode !== 'preview')
      throw new ServiceUnavailableException({ code: 'CUSTOMER_SIGN_IN_CLOSED' });
  }
  private async event(
    m: Pick<EntityManager, 'query'>,
    id: string | null,
    action: 'login' | 'login_failed' | 'logout',
    request: string,
  ) {
    await m.query(
      'INSERT INTO store_customer_events(account_id,action,request_id)VALUES($1,$2,$3)',
      [id, action, request],
    );
  }
  private async limit(bucket: string, max: number) {
    const [r] = await this.db.query(
      `INSERT INTO store_customer_login_limits(bucket_hash,attempts)VALUES($1,1)ON CONFLICT(bucket_hash)DO UPDATE SET attempts=CASE WHEN store_customer_login_limits.window_start<=now()-interval '15 minutes' THEN 1 ELSE store_customer_login_limits.attempts+1 END,window_start=CASE WHEN store_customer_login_limits.window_start<=now()-interval '15 minutes' THEN now() ELSE store_customer_login_limits.window_start END RETURNING attempts`,
      [tokenHash('customer:' + bucket)],
    );
    if (r.attempts > max) throw new HttpException({ code: 'CUSTOMER_LOGIN_THROTTLED' }, 429);
  }
  async login(email: string, password: string, ip: string, request: string) {
    this.open();
    await this.limit('source:' + ip, 40);
    await this.limit('email:' + email, 15);
    const [candidate]: Account[] = await this.db.query(
      'SELECT id,email,display_name,password_hash,is_active FROM store_customer_accounts WHERE email=$1',
      [email],
    );
    const valid = await this.passwords.verify(password, candidate?.password_hash);
    if (!valid || !candidate?.is_active) {
      await this.event(this.db, candidate?.id ?? null, 'login_failed', request);
      throw new UnauthorizedException({ code: 'CUSTOMER_INVALID_CREDENTIALS' });
    }
    const token = randomBytes(32).toString('base64url'),
      csrf = randomBytes(32).toString('hex');
    try {
      await this.db.query('SELECT public.store_customer_session_create($1,$2,$3,$4,$5)', [
        candidate.id,
        candidate.password_hash,
        tokenHash(token),
        csrf,
        request,
      ]);
    } catch (e) {
      if (
        e &&
        typeof e === 'object' &&
        'message' in e &&
        String(e.message).includes('CUSTOMER_INVALID_CREDENTIALS')
      )
        throw new UnauthorizedException({ code: 'CUSTOMER_INVALID_CREDENTIALS' });
      throw e;
    }
    return { token };
  }

  async session(input: unknown) {
    this.open();
    const token = customerToken(input);
    if (!token) throw new UnauthorizedException({ code: 'CUSTOMER_SESSION_REQUIRED' });
    const [u]: Session[] = await this.db.query(
      `SELECT a.id,a.email,a.display_name,s.id AS session_id,s.csrf_token,s.expires_at FROM store_customer_sessions s JOIN store_customer_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes' AND a.is_active`,
      [tokenHash(token)],
    );
    if (!u) throw new UnauthorizedException({ code: 'CUSTOMER_SESSION_REQUIRED' });
    await this.db.query(
      "UPDATE store_customer_sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at<now()-interval '1 minute' AND revoked_at IS NULL",
      [u.session_id],
    );
    return {
      account: { displayName: u.display_name, email: u.email },
      expiresAt: u.expires_at.toISOString(),
      csrfToken: u.csrf_token,
    };
  }
  async logout(input: unknown, csrf: unknown, request: string) {
    this.open();
    const token = customerToken(input);
    if (!token || typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf))
      throw new ForbiddenException({ code: 'CUSTOMER_REQUEST_DENIED' });
    return this.db.transaction(async (m) => {
      const [s]: { id: string; account_id: string; csrf_token: string; revoked_at: Date | null }[] =
        await m.query(
          'SELECT id,account_id,csrf_token,revoked_at FROM store_customer_sessions WHERE token_hash=$1 FOR UPDATE',
          [tokenHash(token)],
        );
      if (!s || !timingSafeEqual(Buffer.from(csrf), Buffer.from(s.csrf_token)))
        throw new ForbiddenException({ code: 'CUSTOMER_REQUEST_DENIED' });
      if (!s.revoked_at) {
        await m.query('UPDATE store_customer_sessions SET revoked_at=now() WHERE id=$1', [s.id]);
        await this.event(m, s.account_id, 'logout', request);
      }
      return { status: 'ok' };
    });
  }
}
