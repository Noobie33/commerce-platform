import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { tokenHash, IdentityService } from './identity.service.js';
import { PasswordService } from './password.service.js';
import type { AuthConfig } from './auth.config.js';
import type { Principal } from './http.types.js';
import type {
  EnrollmentInput,
  EnrollmentPage,
  EnrollmentView,
  EnrollmentResult,
} from './onboarding.types.js';
const columns = `u.id,u.username,u.display_name AS "displayName",u.is_active AS active,o.version,o.state,o.expires_at AS "expiresAt",o.activated_at AS "activatedAt",CASE WHEN NOT u.is_active THEN 'disabled' WHEN o.state='pending' AND o.expires_at<=clock_timestamp() THEN 'expired' ELSE o.state END AS status`;
export class StaffOnboardingService {
  constructor(
    private readonly db: DataSource,
    private readonly passwords: PasswordService,
    private readonly identity: IdentityService,
    private readonly config: AuthConfig,
  ) {}
  private async owner(actor: string, sql: Pick<DataSource, 'query'> = this.db) {
    const [r] = await sql.query('SELECT public.staff_access_owner($1) AS allowed', [actor]);
    if (!r?.allowed) throw new ForbiddenException({ code: 'ACCESS_OWNER_ONLY' });
  }
  async list(actor: string, q: { search: string; page: number }): Promise<EnrollmentPage> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.owner(actor, m);
      const search = '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%',
        from =
          ' FROM staff_onboarding o JOIN staff_users u ON u.id=o.staff_id WHERE(u.username ILIKE $1 OR u.display_name ILIKE $1)';
      const [c] = await m.query('SELECT count(*)::int AS total' + from, [search]);
      const items = await m.query(
        'SELECT ' + columns + from + ' ORDER BY u.created_at DESC,u.id LIMIT 20 OFFSET $2',
        [search, (q.page - 1) * 20],
      );
      return { items, total: c.total, page: q.page };
    });
  }
  async read(actor: string, id: string, page: number): Promise<EnrollmentView> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.owner(actor, m);
      const [record] = await m.query(
        'SELECT ' +
          columns +
          ' FROM staff_onboarding o JOIN staff_users u ON u.id=o.staff_id WHERE u.id=$1',
        [id],
      );
      if (!record) throw new NotFoundException({ code: 'ENROLLMENT_NOT_FOUND' });
      const history = await m.query(
        'SELECT e.version,e.action,e.reason,u.display_name AS "actorName",e.created_at AS "createdAt",e.state,e.expires_at AS "expiresAt" FROM staff_onboarding_events e JOIN staff_users u ON u.id=e.actor_id WHERE e.staff_id=$1 ORDER BY e.version DESC LIMIT 21 OFFSET $2',
        [id, (page - 1) * 20],
      );
      return { record, history: history.slice(0, 20), hasMore: history.length > 20, page };
    });
  }
  async post(
    principal: Principal,
    input: EnrollmentInput,
    password: string,
    key: string,
    requestId: string,
  ): Promise<EnrollmentResult> {
    await this.owner(principal.id);
    await this.identity.limitOnboardingOwner(principal.id);
    const [u] = await this.db.query(
      'SELECT password_hash FROM staff_users WHERE id=$1 AND is_active',
      [principal.id],
    );
    if (!(await this.passwords.verify(password, u?.password_hash))) {
      await this.db.query(
        "INSERT INTO audit_events(actor_id,action,request_id) VALUES($1,'staff.enrollment_reauthentication_failed',$2)",
        [principal.id, requestId],
      );
      throw new ForbiddenException({ code: 'ENROLLMENT_REAUTH_REQUIRED' });
    }
    const code = input.action === 'revoke' ? null : randomBytes(32).toString('base64url');
    try {
      const result = (
        await this.db.query(
          'SELECT public.staff_onboarding_owner_post($1,$2,$3,$4,$5,$6,$7::jsonb) AS result',
          [
            key,
            principal.id,
            principal.sessionId,
            requestId,
            u.password_hash,
            code ? tokenHash(code) : null,
            JSON.stringify(input),
          ],
        )
      )[0].result;
      return {
        ...result,
        ...(result.issued && code ? { activationCode: code } : {}),
        activationUrl: this.config.origin + '/admin#activate',
      };
    } catch (e) {
      return this.failure(e);
    }
  }
  async activate(
    input: { username: string; code: string; newPassword: string },
    ip: string,
    requestId: string,
  ) {
    await this.identity.limitStaffActivation(input.username, ip);
    const hash = tokenHash(input.code);
    const [candidate] = await this.db.query(
      "SELECT 1 FROM staff_onboarding o JOIN staff_users u ON u.id=o.staff_id WHERE u.username=$1 AND o.code_hash=$2 AND o.state='pending' AND o.expires_at>clock_timestamp() AND u.is_active AND u.must_change_password AND u.password_hash='!pending-enrollment' AND NOT EXISTS(SELECT 1 FROM staff_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.staff_id=u.id AND r.code='owner')",
      [input.username, hash],
    );
    if (!candidate) throw new BadRequestException({ code: 'ENROLLMENT_ACTIVATION_INVALID' });
    const passwordHash = await this.passwords.hash(input.newPassword);
    try {
      return (
        await this.db.query('SELECT public.staff_onboarding_activate($1,$2,$3,$4) AS result', [
          input.username,
          hash,
          passwordHash,
          requestId,
        ])
      )[0].result;
    } catch (e) {
      return this.failure(e);
    }
  }
  private failure(e: unknown): never {
    const code = e instanceof Error ? e.message : '';
    if (code === 'ENROLLMENT_PERMISSION') throw new ForbiddenException({ code });
    if (['ENROLLMENT_INVALID', 'ENROLLMENT_ACTIVATION_INVALID'].includes(code))
      throw new BadRequestException({ code });
    if (code === 'ENROLLMENT_NOT_FOUND') throw new NotFoundException({ code });
    if (
      [
        'ENROLLMENT_IDEMPOTENCY',
        'ENROLLMENT_STALE',
        'ENROLLMENT_STATE',
        'ENROLLMENT_DISABLED',
      ].includes(code)
    )
      throw new ConflictException({ code });
    if (
      e &&
      typeof e === 'object' &&
      'driverError' in e &&
      e.driverError &&
      typeof e.driverError === 'object' &&
      'code' in e.driverError &&
      e.driverError.code === '23505'
    )
      throw new ConflictException({ code: 'ENROLLMENT_USERNAME_EXISTS' });
    throw e;
  }
}
