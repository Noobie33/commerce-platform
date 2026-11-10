import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AccessInput, AccessKind, AccessRecord } from './access.types.js';
export class StaffAccessService {
  constructor(private readonly db: DataSource) {}
  private async owner(actor: string, sql: Pick<DataSource, 'query'> = this.db) {
    if (!(await sql.query('SELECT public.staff_access_owner($1) AS allowed', [actor]))[0]?.allowed)
      throw new ForbiddenException({ code: 'ACCESS_OWNER_ONLY' });
  }
  async policy(actor: string) {
    await this.owner(actor);
    return this.db.query(
      'SELECT code,location_scope AS "locationScope" FROM access_permission_policy ORDER BY code',
    );
  }
  async list(actor: string, kind: AccessKind, q: { search: string; page: number }) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.owner(actor, m);
      const staff = kind === 'staff',
        table = staff ? 'staff_users' : 'roles',
        where = staff
          ? '(display_name ILIKE $1 OR username ILIKE $1)'
          : '(code ILIKE $1 OR EXISTS(SELECT 1 FROM role_access_profiles p WHERE p.role_id=roles.id AND p.label ILIKE $1))',
        search = '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%';
      const [count] = await m.query(
        'SELECT count(*)::int AS total FROM ' + table + ' WHERE ' + where,
        [search],
      );
      const rows = await m.query(
        'SELECT id FROM ' +
          table +
          ' WHERE ' +
          where +
          ' ORDER BY ' +
          (staff ? 'lower(display_name)' : 'code') +
          ',id LIMIT 20 OFFSET $2',
        [search, (q.page - 1) * 20],
      );
      const items = [];
      for (const row of rows) items.push(await this.record(m, kind, row.id));
      return { items, total: count.total, page: q.page };
    });
  }
  private async record(
    sql: Pick<DataSource, 'query'>,
    kind: AccessKind,
    id: string,
  ): Promise<AccessRecord> {
    const [r] = await sql.query('SELECT public.staff_access_snapshot($1,$2) AS record', [kind, id]);
    if (!r.record) throw new NotFoundException({ code: 'ACCESS_NOT_FOUND' });
    const [guard] = await sql.query(
      kind === 'staff'
        ? "SELECT EXISTS(SELECT 1 FROM staff_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.staff_id=$1 AND r.code='owner') AS protected"
        : "SELECT code='owner' OR EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND NOT EXISTS(SELECT 1 FROM access_permission_policy p WHERE p.code=rp.permission_code)) AS protected FROM roles r WHERE r.id=$1",
      [id],
    );
    if (kind === 'staff')
      r.record.assignments = await sql.query(
        'SELECT a.role_id AS "roleId",a.location_id AS "locationId",coalesce(p.label,r.code) AS "roleLabel",l.name AS "locationLabel" FROM staff_role_assignments a JOIN roles r ON r.id=a.role_id LEFT JOIN role_access_profiles p ON p.role_id=r.id LEFT JOIN locations l ON l.id=a.location_id WHERE a.staff_id=$1 ORDER BY a.role_id,a.location_id NULLS FIRST',
        [id],
      );
    if (kind === 'role')
      r.record.assignedStaffCount = (
        await sql.query(
          'SELECT count(DISTINCT staff_id)::int AS n FROM staff_role_assignments WHERE role_id=$1',
          [id],
        )
      )[0].n;
    return { ...r.record, protected: guard.protected };
  }
  async read(actor: string, kind: AccessKind, id: string, page: number) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.owner(actor, m);
      const record = await this.record(m, kind, id);
      const history = await m.query(
        'SELECT e.version,e.reason,e.snapshot,e.before_snapshot AS before,e.revoked_sessions AS "revokedSessions",e.created_at AS "createdAt",u.display_name AS "actorName" FROM staff_access_events e JOIN staff_users u ON u.id=e.actor_id WHERE e.kind=$1 AND e.entity_id=$2 ORDER BY e.version DESC LIMIT 21 OFFSET $3',
        [kind, id, (page - 1) * 20],
      );
      return { record, history: history.slice(0, 20), page, hasMore: history.length > 20 };
    });
  }
  async choices(actor: string, kind: string, q: { search: string; page: number }) {
    await this.owner(actor);
    if (kind !== 'roles' && kind !== 'locations') throw new BadRequestException();
    const where =
      kind === 'roles'
        ? "FROM roles r LEFT JOIN role_access_profiles p ON p.role_id=r.id WHERE r.code<>'owner' AND coalesce(p.active,true) AND NOT EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND NOT EXISTS(SELECT 1 FROM access_permission_policy ap WHERE ap.code=rp.permission_code)) AND (r.code ILIKE $1 OR p.label ILIKE $1)"
        : 'FROM locations r WHERE r.is_active AND(r.name ILIKE $1 OR r.code ILIKE $1)';
    const search = '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%';
    const [c] = await this.db.query('SELECT count(*)::int AS total ' + where, [search]);
    const items = await this.db.query(
      (kind === 'roles'
        ? 'SELECT r.id,coalesce(p.label,r.code) AS label,NOT EXISTS(SELECT 1 FROM role_permissions rp JOIN access_permission_policy ap ON ap.code=rp.permission_code WHERE rp.role_id=r.id AND NOT ap.location_scope) AS "locationCompatible" '
        : 'SELECT r.id,r.name AS label,true AS "locationCompatible" ') +
        where +
        ' ORDER BY label,r.id LIMIT 20 OFFSET $2',
      [search, (q.page - 1) * 20],
    );
    return { items, total: c.total, page: q.page };
  }
  async post(actor: string, input: AccessInput, key: string, requestId: string) {
    try {
      return (
        await this.db.query('SELECT public.staff_access_post($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          requestId,
          JSON.stringify(input),
        ])
      )[0].result;
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      if (code === 'ACCESS_PERMISSION' || code === 'ACCESS_PROTECTED')
        throw new ForbiddenException({ code });
      if (code === 'ACCESS_INVALID') throw new BadRequestException({ code });
      if (code === 'ACCESS_NOT_FOUND') throw new NotFoundException({ code });
      if (
        ['ACCESS_STALE', 'ACCESS_IDEMPOTENCY', 'ACCESS_SCOPE', 'ACCESS_ROLE_IN_USE'].includes(code)
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
        throw new ConflictException({ code: 'ACCESS_CODE_EXISTS' });
      throw e;
    }
  }
}
