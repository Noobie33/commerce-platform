import type { EntityManager } from 'typeorm';

export type AuditAction =
  | 'staff.bootstrap'
  | 'staff.login'
  | 'staff.login_failed'
  | 'staff.logout'
  | 'staff.password_changed'
  | 'access.denied';

export class AuditService {
  async catalog(
    sql: Pick<EntityManager, 'query'>,
    actorId: string,
    action: 'catalog.product_created' | 'catalog.product_updated' | 'catalog.category_created',
    requestId: string,
    details: {
      entityId: string;
      version: number;
      variantCount: number;
      before?: CatalogAuditSnapshot | null;
      after?: CatalogAuditSnapshot;
    },
  ): Promise<void> {
    const metadata = {
      entityId: details.entityId,
      version: details.version,
      variantCount: details.variantCount,
      ...(details.before !== undefined ? { before: details.before } : {}),
      ...(details.after ? { after: details.after } : {}),
    };
    await sql.query(
      'INSERT INTO audit_events(actor_id,action,request_id,metadata) VALUES ($1,$2,$3,$4::jsonb)',
      [actorId, action, requestId, JSON.stringify(metadata)],
    );
  }
  async append(
    sql: Pick<EntityManager, 'query'>,
    actorId: string | null,
    action: AuditAction,
    requestId: string,
    permission?: string,
  ): Promise<void> {
    // Explicit fields only: callers cannot pass request bodies, tokens or password hashes.
    const metadata = permission ? { permission } : {};
    await sql.query(
      'INSERT INTO audit_events(actor_id,action,request_id,metadata) VALUES ($1,$2,$3,$4::jsonb)',
      [actorId, action, requestId, JSON.stringify(metadata)],
    );
  }
}

export interface CatalogAuditSnapshot {
  styleCode: string;
  name: string;
  categoryId: string | null;
  status: string;
  variants: {
    sku: string;
    attributes: Record<string, string>;
    barcode: string | null;
    price: string;
    isActive: boolean;
  }[];
}
