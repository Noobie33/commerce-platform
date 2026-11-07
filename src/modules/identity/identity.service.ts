import { HttpException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import type { Principal } from './http.types.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
}

export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');

export class IdentityService {
  constructor(
    private readonly source: DataSource,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  private async rateLimit(bucket: string, maximum: number): Promise<void> {
    const rows: { attempts: number }[] = await this.source.query(
      `
      INSERT INTO login_rate_limits(bucket_hash, attempts) VALUES ($1, 1)
      ON CONFLICT (bucket_hash) DO UPDATE SET
        attempts = CASE WHEN login_rate_limits.window_start <= now() - interval '15 minutes' THEN 1 ELSE login_rate_limits.attempts + 1 END,
        window_start = CASE WHEN login_rate_limits.window_start <= now() - interval '15 minutes' THEN now() ELSE login_rate_limits.window_start END
      RETURNING attempts`,
      [tokenHash(bucket)],
    );
    if (rows[0]!.attempts > maximum)
      throw new HttpException('Too many login attempts; try later', 429);
  }

  async login(username: string, password: string, ip: string, requestId: string) {
    await this.rateLimit('ip:' + ip, 30);
    await this.rateLimit('user:' + username, 15);
    const [candidate]: UserRow[] = await this.source.query(
      'SELECT * FROM staff_users WHERE username=$1',
      [username],
    );
    const valid = await this.passwords.verify(password, candidate?.password_hash);
    if (!valid || !candidate?.is_active) {
      await this.audit.append(this.source, candidate?.id ?? null, 'staff.login_failed', requestId);
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.source.transaction(async (manager) => {
      const [current]: UserRow[] = await manager.query(
        'SELECT * FROM staff_users WHERE id=$1 FOR UPDATE',
        [candidate.id],
      );
      if (!current?.is_active || current.password_hash !== candidate.password_hash)
        throw new UnauthorizedException('Invalid credentials');
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('hex');
      await manager.query(
        'INSERT INTO staff_sessions(staff_id,token_hash,csrf_token) VALUES ($1,$2,$3)',
        [current.id, tokenHash(token), csrfToken],
      );
      await this.audit.append(manager, current.id, 'staff.login', requestId);
      return { token, csrfToken, user: this.userView(current) };
    });
  }

  async authenticate(token: string): Promise<Principal> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Authentication required');
    const rows: (UserRow & { session_id: string; csrf_token: string })[] = await this.source.query(
      `
      SELECT u.*, s.id AS session_id, s.csrf_token FROM staff_sessions s
      JOIN staff_users u ON u.id=s.staff_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.last_seen_at > now() - interval '30 minutes' AND u.is_active
    `,
      [tokenHash(token)],
    );
    const user = rows[0];
    if (!user) throw new UnauthorizedException('Authentication required');
    const rowsOfGrants: { code: string; location_id: string | null }[] = await this.source.query(
      `
      SELECT DISTINCT rp.permission_code AS code, a.location_id FROM staff_role_assignments a
      JOIN role_permissions rp ON rp.role_id=a.role_id
      LEFT JOIN locations l ON l.id=a.location_id
      WHERE a.staff_id=$1 AND (a.location_id IS NULL OR l.is_active)
    `,
      [user.id],
    );
    await this.source.query(
      "UPDATE staff_sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at < now()-interval '1 minute'",
      [user.session_id],
    );
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      mustChangePassword: user.must_change_password,
      sessionId: user.session_id,
      csrfToken: user.csrf_token,
      grants: rowsOfGrants.map((grant) => ({ code: grant.code, locationId: grant.location_id })),
    };
  }

  assertCsrf(principal: Principal, token: unknown): void {
    if (
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(principal.csrfToken))
    ) {
      throw new HttpException('Request verification failed', 403);
    }
  }

  async logout(principal: Principal, requestId: string): Promise<void> {
    await this.source.transaction(async (manager) => {
      const revoked: { id: string }[] = await manager.query(
        'UPDATE staff_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id',
        [principal.sessionId],
      );
      if (revoked.length) await this.audit.append(manager, principal.id, 'staff.logout', requestId);
    });
  }

  async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    requestId: string,
  ): Promise<void> {
    await this.rateLimit('password-change:' + principal.id, 10);
    const hash = await this.passwords.hash(newPassword);
    await this.source.transaction(async (manager) => {
      const [user]: UserRow[] = await manager.query(
        'SELECT * FROM staff_users WHERE id=$1 AND is_active FOR UPDATE',
        [principal.id],
      );
      const sessions: { id: string }[] = await manager.query(
        `
        SELECT id FROM staff_sessions WHERE id=$1 AND staff_id=$2 AND revoked_at IS NULL
        AND expires_at > now() AND last_seen_at > now()-interval '30 minutes' FOR UPDATE
      `,
        [principal.sessionId, principal.id],
      );
      if (
        !user ||
        !sessions.length ||
        !(await this.passwords.verify(currentPassword, user.password_hash))
      ) {
        throw new UnauthorizedException('Invalid credentials');
      }
      await manager.query(
        'UPDATE staff_users SET password_hash=$1,must_change_password=false WHERE id=$2',
        [hash, principal.id],
      );
      await manager.query(
        'UPDATE staff_sessions SET revoked_at=now() WHERE staff_id=$1 AND revoked_at IS NULL',
        [principal.id],
      );
      await this.audit.append(manager, principal.id, 'staff.password_changed', requestId);
    });
  }

  async denied(principal: Principal, code: string, requestId: string): Promise<void> {
    await this.audit.append(this.source, principal.id, 'access.denied', requestId, code);
  }

  async listStaff() {
    return this.source.query(
      'SELECT id,username,display_name AS "displayName",is_active AS "isActive" FROM staff_users ORDER BY username LIMIT 100',
    );
  }

  private userView(user: UserRow) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      mustChangePassword: user.must_change_password,
    };
  }
}
