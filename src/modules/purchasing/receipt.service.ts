import type { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { permits } from '../authorization/policy.js';
import type { Principal } from '../identity/http.types.js';
import { receiptError } from './receipt.errors.js';
import type {
  ReceiptInput,
  ReverseReceiptInput,
  ReceiptResult,
  ReceivingPage,
  ReceivingLine,
  PurchaseReceipt,
} from './receipt.types.js';
export class PurchaseReceiptService {
  constructor(private readonly source: DataSource) {}
  async receiving(id: string, page: number, user: Principal): Promise<ReceivingPage> {
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const rows = await m.query(
        'SELECT o.id,o.number,o.status,o.location_id AS "locationId",l.name AS "locationName",l.is_active AS active,coalesce(s.version,1) AS revision FROM purchase_orders o JOIN locations l ON l.id=o.location_id LEFT JOIN purchase_receipt_state s ON s.order_id=o.id WHERE o.id=$1',
        [id],
      );
      const po = rows[0];
      if (!po) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
      const can = (action: string, stock: string) =>
        po.status === 'issued' &&
        po.active &&
        permits(user.grants, action, po.locationId) &&
        permits(user.grants, 'inventory.read', po.locationId) &&
        permits(user.grants, stock, po.locationId);
      const lines: ReceivingLine[] = await m.query(
        `SELECT l.id,l.variant_id AS "variantId",l.sku,l.product_name AS "productName",l.quantity::text AS ordered,coalesce(r.received,0)::text AS received,(l.quantity-coalesce(r.received,0))::text AS remaining FROM purchase_order_lines l LEFT JOIN(SELECT x.order_line_id,sum(x.quantity) AS received FROM purchase_receipt_lines x WHERE x.order_id=$1 AND NOT EXISTS(SELECT 1 FROM purchase_receipt_reversals v WHERE v.receipt_id=x.receipt_id) GROUP BY x.order_line_id) r ON r.order_line_id=l.id WHERE l.order_id=$1 ORDER BY l.sku,l.id`,
        [id],
      );
      const total = (
        await m.query('SELECT count(*)::int AS n FROM purchase_receipts WHERE order_id=$1', [id])
      )[0].n;
      const items: Omit<PurchaseReceipt, 'canReverse'>[] = await m.query(
        `SELECT r.id,r.reason,r.reference,r.created_at AS "createdAt",u.display_name AS "actorName",r.inventory_posting_id AS "inventoryPostingId",v.created_at AS "reversedAt",v.reason AS "reversalReason",(SELECT jsonb_agg(jsonb_build_object('orderLineId',x.order_line_id,'sku',l.sku,'productName',l.product_name,'quantity',x.quantity::text) ORDER BY l.sku) FROM purchase_receipt_lines x JOIN purchase_order_lines l ON l.id=x.order_line_id WHERE x.receipt_id=r.id) AS lines FROM purchase_receipts r JOIN staff_users u ON u.id=r.actor_id LEFT JOIN purchase_receipt_reversals v ON v.receipt_id=r.id WHERE r.order_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET $2`,
        [id, (page - 1) * 20],
      );
      return {
        orderId: id,
        orderNumber: po.number,
        locationId: po.locationId,
        locationName: po.locationName,
        orderStatus: po.status,
        receiptRevision: po.revision,
        canReceive: can('purchasing.receive', 'inventory.receive'),
        hasActiveReceipts: lines.some((l) => BigInt(l.received) > 0n),
        lines,
        items: items.map((r) => ({
          ...r,
          createdAt: new Date(r.createdAt).toISOString(),
          reversedAt: r.reversedAt ? new Date(r.reversedAt).toISOString() : null,
          canReverse: !r.reversedAt && can('purchasing.reverse_receipt', 'inventory.adjust'),
        })),
        total,
        page,
        pageSize: 20,
      };
    });
  }
  async post(
    input: ReceiptInput | ReverseReceiptInput,
    actor: string,
    key: string,
    requestId: string,
  ): Promise<ReceiptResult> {
    try {
      return (
        await this.source.query(
          'SELECT public.purchase_receipt_post($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS result',
          [key, actor, requestId, JSON.stringify(input)],
        )
      )[0].result;
    } catch (error) {
      receiptError(error);
    }
  }
}
