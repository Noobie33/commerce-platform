import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PurchasingStore, escapeSearch } from './purchasing.store.js';
import { decimal, minor, invalid } from './purchasing.validation.js';
import type {
  OrderInput,
  PurchaseOrder,
  PageQuery,
  Page,
  PurchaseVariant,
  PurchaseLocation,
} from './purchasing.types.js';
type Sql = Pick<EntityManager, 'query'>;
export class PurchaseOrderService {
  constructor(private readonly store: PurchasingStore) {}
  locations(): Promise<PurchaseLocation[]> {
    return this.store.source.query(
      'SELECT id,code,name FROM locations WHERE is_active ORDER BY name,id',
    );
  }
  variants(search: string): Promise<PurchaseVariant[]> {
    if (search.length < 2) return Promise.resolve([]);
    return this.store.source.query(
      'SELECT v.id AS "variantId",v.sku,p.name AS "productName",v.attributes FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.is_active AND p.status<>\'archived\' AND (v.sku ILIKE $1 OR p.name ILIKE $1 OR p.style_code ILIKE $1) ORDER BY v.sku,v.id LIMIT 20',
      [escapeSearch(search)],
    );
  }
  private headers = `SELECT o.id,o.number,o.supplier_id AS "supplierId",coalesce(o.supplier_snapshot->>'name',s.name) AS "supplierName",o.location_id AS "locationId",l.name AS "locationName",o.status,o.currency,to_char(o.expected_on,'YYYY-MM-DD') AS "expectedOn",o.reference,o.notes,o.total_minor::text AS total,o.version,o.issued_at AS "issuedAt",o.cancelled_at AS "cancelledAt",o.cancellation_reason AS "cancellationReason",o.supplier_snapshot AS "supplierSnapshot",o.created_at AS "createdAt",o.updated_at AS "updatedAt" FROM purchase_orders o JOIN purchasing_suppliers s ON s.id=o.supplier_id JOIN locations l ON l.id=o.location_id`;
  private dates(row: PurchaseOrder): PurchaseOrder {
    return {
      ...row,
      total: decimal(row.total),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      issuedAt: row.issuedAt ? new Date(row.issuedAt).toISOString() : null,
      cancelledAt: row.cancelledAt ? new Date(row.cancelledAt).toISOString() : null,
    };
  }
  async detail(id: string, m: Sql): Promise<PurchaseOrder> {
    const rows = await m.query(this.headers + ' WHERE o.id=$1', [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
    const lines = await m.query(
      'SELECT variant_id AS "variantId",sku,product_name AS "productName",attributes,quantity::text AS quantity,unit_cost_minor::text AS "unitCost",line_total_minor::text AS "lineTotal" FROM purchase_order_lines WHERE order_id=$1 ORDER BY sku,variant_id',
      [id],
    );
    return {
      ...this.dates(rows[0]),
      lines: lines.map((r: { unitCost: string; lineTotal: string }) => ({
        ...r,
        unitCost: decimal(r.unitCost),
        lineTotal: decimal(r.lineTotal),
      })),
    };
  }
  read(id: string) {
    return this.store.source.transaction('REPEATABLE READ', (m) => this.detail(id, m));
  }
  list(q: PageQuery): Promise<Page<PurchaseOrder>> {
    return this.store.source.transaction('REPEATABLE READ', async (m) => {
      const args = [escapeSearch(q.search), q.status],
        where =
          "($1='%%' OR o.number ILIKE $1 OR coalesce(o.supplier_snapshot->>'name',s.name) ILIKE $1 OR o.reference ILIKE $1) AND ($2='all' OR o.status=$2)";
      const total = (
        await m.query(
          'SELECT count(*)::int AS n FROM purchase_orders o JOIN purchasing_suppliers s ON s.id=o.supplier_id WHERE ' +
            where,
          args,
        )
      )[0].n;
      const rows = await m.query(
        this.headers +
          ' WHERE ' +
          where +
          ' ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET $3',
        [...args, (q.page - 1) * 20],
      );
      return {
        items: rows.map((r: PurchaseOrder) => ({ ...this.dates(r), lines: [] })),
        total,
        page: q.page,
        pageSize: 20,
      };
    });
  }
  private async active(m: Sql, supplierId: string, locationId: string) {
    const rows = await m.query(
      'SELECT id,code,name,contact_name AS "contactName",phone,email,address,tax_reference AS "taxReference" FROM purchasing_suppliers WHERE id=$1 AND is_active FOR SHARE',
      [supplierId],
    );
    if (!rows[0]) invalid('Choose an active supplier');
    if (!(await m.query('SELECT id FROM locations WHERE id=$1 AND is_active', [locationId])).length)
      invalid('Choose an active delivery location');
    return rows[0] as Record<string, unknown>;
  }
  private async locked(m: Sql, id: string, expectedVersion: number, statuses: string[]) {
    const rows = await m.query(
      'SELECT version,status,supplier_id,location_id FROM purchase_orders WHERE id=$1 FOR UPDATE',
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
    if (row.version !== expectedVersion)
      throw new ConflictException({ code: 'STALE_PURCHASING_RECORD' });
    if (!statuses.includes(row.status))
      throw new ConflictException({ code: 'PURCHASE_ORDER_STATE' });
    return row as { version: number; status: string; supplier_id: string; location_id: string };
  }
  save(id: string | null, input: OrderInput, actor: string, key: string, requestId: string) {
    return this.store.write(
      actor,
      key,
      requestId,
      { operation: 'order.save', id, input },
      async (m) => {
        if (id) await this.locked(m, id, input.expectedVersion!, ['draft']);
        await this.active(m, input.supplierId, input.locationId);
        let target = id;
        if (!target)
          target = (
            await m.query(
              'INSERT INTO purchase_orders(supplier_id,location_id,created_by) VALUES($1,$2,$3) RETURNING id',
              [input.supplierId, input.locationId, actor],
            )
          )[0].id;
        if (id) await m.query('DELETE FROM purchase_order_lines WHERE order_id=$1', [id]);
        let total = 0n;
        for (const line of input.lines) {
          const rows = await m.query(
            "SELECT v.sku,v.attributes,p.name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id=$1 AND v.is_active AND p.status<>'archived'",
            [line.variantId],
          );
          if (!rows[0]) invalid('Choose active, non-archived product variants');
          const row = rows[0];
          const cost = minor(line.unitCost);
          total += cost * BigInt(line.quantity);
          await m.query(
            'INSERT INTO purchase_order_lines(order_id,variant_id,sku,product_name,attributes,quantity,unit_cost_minor) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',
            [
              target,
              line.variantId,
              row.sku,
              row.name,
              JSON.stringify(row.attributes),
              line.quantity,
              cost.toString(),
            ],
          );
        }
        await m.query(
          'UPDATE purchase_orders SET supplier_id=$2,location_id=$3,expected_on=$4,reference=$5,notes=$6,total_minor=$7,version=version+$8,updated_at=now() WHERE id=$1',
          [
            target,
            input.supplierId,
            input.locationId,
            input.expectedOn,
            input.reference,
            input.notes,
            total.toString(),
            id ? 1 : 0,
          ],
        );
        const value = await this.detail(target!, m);
        return {
          value,
          id: value.id,
          entity: 'order',
          action: id ? 'purchasing.order_updated' : 'purchasing.order_created',
          version: value.version,
        };
      },
    );
  }
  action(
    id: string,
    operation: 'issue' | 'cancel',
    input: { expectedVersion: number; reason: string },
    actor: string,
    key: string,
    requestId: string,
  ) {
    return this.store.write(
      actor,
      key,
      requestId,
      { operation: 'order.' + operation, id, input },
      async (m) => {
        const row = await this.locked(
          m,
          id,
          input.expectedVersion,
          operation === 'issue' ? ['draft'] : ['draft', 'issued'],
        );
        if (operation === 'issue') {
          const supplier = await this.active(m, row.supplier_id, row.location_id);
          const lines = await m.query(
            'SELECT l.id,v.sku,v.attributes,p.name,v.is_active,p.status FROM purchase_order_lines l JOIN catalog_variants v ON v.id=l.variant_id JOIN catalog_products p ON p.id=v.product_id WHERE l.order_id=$1 ORDER BY l.variant_id',
            [id],
          );
          if (
            !lines.length ||
            lines.some(
              (l: { is_active: boolean; status: string }) =>
                !l.is_active || l.status === 'archived',
            )
          )
            invalid('Every ordered variant must be active before issue');
          for (const line of lines)
            await m.query(
              'UPDATE purchase_order_lines SET sku=$2,product_name=$3,attributes=$4::jsonb WHERE id=$1',
              [line.id, line.sku, line.name, JSON.stringify(line.attributes)],
            );
          await m.query(
            "UPDATE purchase_orders SET status='issued',issued_at=now(),supplier_snapshot=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
            [id, JSON.stringify(supplier)],
          );
        } else
          await m.query(
            "UPDATE purchase_orders SET status='cancelled',cancelled_at=now(),cancellation_reason=$2,version=version+1,updated_at=now() WHERE id=$1",
            [id, input.reason],
          );
        const value = await this.detail(id, m);
        return {
          value,
          id,
          entity: 'order',
          action: 'purchasing.order_' + (operation === 'issue' ? 'issued' : 'cancelled'),
          version: value.version,
        };
      },
    );
  }
}
