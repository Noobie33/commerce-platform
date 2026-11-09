import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { decimal, escaped, listQuery } from './sales.validation.js';
import type {
  SalesInput,
  SalesOrder,
  SalesVariant,
  SalesResult,
  SalesCustomer,
  SalesLocation,
} from './sales.types.js';
export class SalesService {
  constructor(private readonly db: DataSource) {}
  private headers = `SELECT o.id,o.number,o.customer_id AS "customerId",o.customer_snapshot->>'name' AS "customerName",o.customer_snapshot AS "customerSnapshot",o.location_id AS "locationId",l.name AS "locationName",o.channel,o.status,o.currency,to_char(o.fulfill_on,'YYYY-MM-DD') AS "fulfillOn",o.reference,o.notes,o.price_reason AS "priceReason",o.total_minor::text AS total,o.version,o.created_at AS "createdAt",o.updated_at AS "updatedAt",o.cancelled_at AS "cancelledAt",o.cancellation_reason AS "cancellationReason" FROM sales_orders o JOIN locations l ON l.id=o.location_id`;
  customers(search: string): Promise<SalesCustomer[]> {
    if (search.length < 2) return Promise.resolve([]);
    return this.db.query(
      `SELECT id,code,name,version,segment FROM customers WHERE is_active AND(name ILIKE $1 OR code ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1) ORDER BY name,id LIMIT 20`,
      [escaped(search)],
    );
  }
  locations(): Promise<SalesLocation[]> {
    return this.db.query('SELECT id,code,name FROM locations WHERE is_active ORDER BY name,id');
  }
  private variantColumns = `SELECT v.id AS "variantId",v.sku,p.name AS "productName",v.attributes,v.price_minor::text AS "catalogPrice" FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.is_active AND p.status='active'`;
  async variants(search: string): Promise<SalesVariant[]> {
    if (search.length < 2) return [];
    const rows = await this.db.query(
      this.variantColumns +
        ' AND(v.sku ILIKE $1 OR p.name ILIKE $1 OR p.style_code ILIKE $1) ORDER BY v.sku,v.id LIMIT 20',
      [escaped(search)],
    );
    return rows.map((r: SalesVariant) => ({ ...r, catalogPrice: decimal(r.catalogPrice) }));
  }
  async variant(id: string): Promise<SalesVariant> {
    const rows = await this.db.query(this.variantColumns + ' AND v.id=$1', [id]);
    if (!rows[0]) throw new ConflictException({ code: 'SALES_VARIANT_UNAVAILABLE' });
    return { ...rows[0], catalogPrice: decimal(rows[0].catalogPrice) };
  }
  private row(r: SalesOrder): SalesOrder {
    return { ...r, total: decimal(r.total), lines: [] };
  }
  async detail(id: string, m: Pick<EntityManager, 'query'>) {
    const rows = await m.query(this.headers + ' WHERE o.id=$1', [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'SALES_NOT_FOUND' });
    const lines = await m.query(
      'SELECT variant_id AS "variantId",sku,product_name AS "productName",attributes,quantity::text AS quantity,catalog_price_minor::text AS "catalogPrice",unit_price_minor::text AS "unitPrice",price_mode AS "priceMode",line_total_minor::text AS "lineTotal" FROM sales_order_lines WHERE order_id=$1 ORDER BY sku,variant_id',
      [id],
    );
    return {
      ...this.row(rows[0]),
      lines: lines.map((r: { unitPrice: string; catalogPrice: string; lineTotal: string }) => ({
        ...r,
        unitPrice: decimal(r.unitPrice),
        catalogPrice: decimal(r.catalogPrice),
        lineTotal: decimal(r.lineTotal),
      })),
    } as SalesOrder;
  }
  read(id: string) {
    return this.db.transaction('REPEATABLE READ', (m) => this.detail(id, m));
  }
  list(q: ReturnType<typeof listQuery>) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const args = [escaped(q.search), q.status, q.channel],
        where = `($1='%%' OR o.number ILIKE $1 OR o.customer_snapshot->>'name' ILIKE $1 OR o.customer_snapshot->>'code' ILIKE $1 OR o.reference ILIKE $1) AND($2='all' OR o.status=$2) AND($3='all' OR o.channel=$3)`;
      const total = Number(
        (await m.query('SELECT count(*)::int AS n FROM sales_orders o WHERE ' + where, args))[0].n,
      );
      const rows = await m.query(
        this.headers +
          ' WHERE ' +
          where +
          ' ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET $4',
        [...args, (q.page - 1) * 20],
      );
      return { items: rows.map((r: SalesOrder) => this.row(r)), total, page: q.page, pageSize: 20 };
    });
  }
  async save(
    kind: 'create' | 'update' | 'cancel',
    id: string | null,
    input: SalesInput | { expectedVersion: number; reason: string },
    key: string,
    actor: string,
    requestId: string,
  ): Promise<SalesResult> {
    try {
      return (
        await this.db.query('SELECT public.sales_draft_save($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          requestId,
          JSON.stringify({ kind, ...(id ? { id } : {}), ...input }),
        ])
      )[0].result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'SALES_PERMISSION') throw new ForbiddenException({ code: 'FORBIDDEN' });
      if (message === 'SALES_PRICE_PERMISSION') throw new ForbiddenException({ code: message });
      if (message === 'SALES_NOT_FOUND') throw new NotFoundException({ code: message });
      if (message === 'SALES_INVALID')
        throw new BadRequestException({
          code: 'INVALID_SALES_INPUT',
          message: 'Check sales order details',
        });
      if (
        [
          'SALES_STALE',
          'SALES_STATE',
          'SALES_IDEMPOTENCY',
          'SALES_CUSTOMER_UNAVAILABLE',
          'SALES_CUSTOMER_STALE',
          'SALES_CUSTOMER_SEGMENT',
          'SALES_LOCATION_UNAVAILABLE',
          'SALES_VARIANT_UNAVAILABLE',
          'SALES_PRICE_CHANGED',
          'SALES_TOTAL_LIMIT',
        ].includes(message)
      )
        throw new ConflictException({ code: message });
      throw error;
    }
  }
}
