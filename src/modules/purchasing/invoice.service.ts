import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Principal } from '../identity/http.types.js';
import { permits } from '../authorization/policy.js';
import { escapeSearch } from './purchasing.store.js';
import { decimal } from './purchasing.validation.js';
import { invoiceError } from './invoice.errors.js';
import type {
  InvoiceLine,
  InvoiceInput,
  InvoiceReverseInput,
  InvoiceResult,
  InvoicePage,
  InvoiceList,
  SupplierInvoice,
} from './invoice.types.js';
const selectInvoice = `SELECT i.id,i.supplier_id AS "supplierId",b.paid_minor::text AS paid,b.remaining_minor::text AS remaining,i.order_id AS "orderId",o.number AS "orderNumber",i.supplier_snapshot->>'name' AS "supplierName",i.number,i.invoice_on::text AS "invoiceOn",i.due_on::text AS "dueOn",i.goods_minor::text AS goods,i.tax_minor::text AS tax,i.delivery_minor::text AS delivery,i.discount_minor::text AS discount,i.total_minor::text AS total,i.reason,i.created_at AS "createdAt",u.display_name AS "actorName",i.reversed_at AS "reversedAt",i.reversal_reason AS "reversalReason",(SELECT jsonb_agg(jsonb_build_object('receiptId',l.receipt_id,'sku',p.sku,'productName',p.product_name,'quantity',l.quantity::text,'unitCost',l.unit_cost_minor::text,'lineTotal',l.line_total_minor::text) ORDER BY p.sku,l.receipt_id) FROM supplier_invoice_lines l JOIN purchase_order_lines p ON p.id=l.order_line_id WHERE l.invoice_id=i.id) AS lines FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id JOIN purchase_orders o ON o.id=i.order_id JOIN staff_users u ON u.id=i.actor_id`;
type StoredInvoice = Omit<SupplierInvoice, 'createdAt' | 'reversedAt'> & {
  createdAt: Date | string;
  reversedAt: Date | string | null;
};
function convert(row: StoredInvoice): SupplierInvoice {
  return {
    ...row,
    paid: decimal(row.paid),
    remaining: decimal(row.remaining),
    goods: decimal(row.goods),
    tax: decimal(row.tax),
    delivery: decimal(row.delivery),
    discount: decimal(row.discount),
    total: decimal(row.total),
    createdAt: new Date(row.createdAt).toISOString(),
    reversedAt: row.reversedAt ? new Date(row.reversedAt).toISOString() : null,
    lines: row.lines.map((l) => ({
      ...l,
      unitCost: decimal(l.unitCost),
      lineTotal: decimal(l.lineTotal),
    })),
  };
}
export class SupplierInvoiceService {
  constructor(private readonly source: DataSource) {}
  private allow(user: Principal) {
    if (!permits(user.grants, 'purchasing.read') || !permits(user.grants, 'payables.read'))
      throw new ForbiddenException({ code: 'INVOICE_PERMISSION' });
  }
  async list(
    query: { search: string; status: string; page: number },
    user: Principal,
  ): Promise<InvoiceList> {
    this.allow(user);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const where = ` WHERE (i.number ILIKE $1 ESCAPE '\\' OR o.number ILIKE $1 ESCAPE '\\' OR i.supplier_snapshot->>'name' ILIKE $1 ESCAPE '\\') AND ($2='all' OR ($2='active' AND i.reversed_at IS NULL) OR ($2='reversed' AND i.reversed_at IS NOT NULL) OR ($2='unpaid' AND i.reversed_at IS NULL AND b.paid_minor=0) OR ($2='partial' AND i.reversed_at IS NULL AND b.paid_minor>0 AND b.remaining_minor>0) OR ($2='paid' AND i.reversed_at IS NULL AND b.remaining_minor=0) OR ($2='overdue' AND i.reversed_at IS NULL AND b.remaining_minor>0 AND i.due_on<(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date))`,
        args = [escapeSearch(query.search), query.status];
      const c = (
        await m.query(
          'SELECT count(*)::int AS total,coalesce(sum(b.remaining_minor) FILTER(WHERE i.reversed_at IS NULL),0)::text AS unsettled FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id JOIN purchase_orders o ON o.id=i.order_id' +
            where,
          args,
        )
      )[0];
      const rows = await m.query(
        selectInvoice + where + ' ORDER BY i.created_at DESC,i.id DESC LIMIT 20 OFFSET $3',
        [...args, (query.page - 1) * 20],
      );
      return {
        items: rows.map(convert),
        total: c.total,
        unsettled: decimal(c.unsettled),
        page: query.page,
        pageSize: 20,
      };
    });
  }
  async order(
    id: string,
    query: { page: number; linePage: number },
    user: Principal,
  ): Promise<InvoicePage> {
    this.allow(user);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const po = (
        await m.query(
          `SELECT o.supplier_id AS "supplierId",o.number,o.status,o.supplier_snapshot->>'name' AS supplier,coalesce(s.version,1) AS revision FROM purchase_orders o LEFT JOIN supplier_invoice_state s ON s.order_id=o.id WHERE o.id=$1`,
          [id],
        )
      )[0];
      if (!po) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND' });
      const eligible = ` FROM purchase_receipt_lines l JOIN purchase_receipts r ON r.id=l.receipt_id JOIN purchase_order_lines p ON p.id=l.order_line_id LEFT JOIN(SELECT x.receipt_id,x.order_line_id,sum(x.quantity) AS quantity FROM supplier_invoice_lines x JOIN supplier_invoices i ON i.id=x.invoice_id WHERE i.reversed_at IS NULL AND i.order_id=$1 GROUP BY x.receipt_id,x.order_line_id) b ON b.receipt_id=l.receipt_id AND b.order_line_id=l.order_line_id WHERE r.order_id=$1 AND NOT EXISTS(SELECT 1 FROM purchase_receipt_reversals v WHERE v.receipt_id=r.id) AND l.quantity>coalesce(b.quantity,0)`;
      const linesTotal = (await m.query('SELECT count(*)::int AS n' + eligible, [id]))[0].n;
      const lines: InvoiceLine[] = await m.query(
        'SELECT r.id AS "receiptId",p.id AS "orderLineId",p.sku,p.product_name AS "productName",r.reference,r.created_at AS "receivedAt",l.quantity::text AS received,coalesce(b.quantity,0)::text AS invoiced,(l.quantity-coalesce(b.quantity,0))::text AS remaining,p.unit_cost_minor::text AS "unitCost"' +
          eligible +
          ' ORDER BY r.created_at,r.id,p.sku LIMIT 25 OFFSET $2',
        [id, (query.linePage - 1) * 25],
      );
      const totals = (
        await m.query(
          'SELECT count(*)::int AS total,coalesce(sum(b.remaining_minor) FILTER(WHERE i.reversed_at IS NULL),0)::text AS unsettled FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id WHERE i.order_id=$1',
          [id],
        )
      )[0];
      const items = await m.query(
        selectInvoice +
          ' WHERE i.order_id=$1 ORDER BY i.created_at DESC,i.id DESC LIMIT 20 OFFSET $2',
        [id, (query.page - 1) * 20],
      );
      return {
        orderId: id,
        supplierId: po.supplierId,
        orderNumber: po.number,
        supplierName: po.supplier,
        invoiceRevision: po.revision,
        canPost: po.status === 'issued' && permits(user.grants, 'payables.manage'),
        canReverse: po.status === 'issued' && permits(user.grants, 'payables.reverse'),
        lines: lines.map((l) => ({
          ...l,
          unitCost: decimal(l.unitCost),
          receivedAt: new Date(l.receivedAt).toISOString(),
        })),
        linesTotal,
        linePage: query.linePage,
        items: items.map(convert),
        total: totals.total,
        page: query.page,
        pageSize: 20,
        unsettled: decimal(totals.unsettled),
      };
    });
  }
  async post(
    input: InvoiceInput | InvoiceReverseInput,
    actor: string,
    key: string,
    requestId: string,
  ): Promise<InvoiceResult> {
    try {
      return (
        await this.source.query(
          'SELECT public.supplier_invoice_post($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS result',
          [key, actor, requestId, JSON.stringify(input)],
        )
      )[0].result;
    } catch (e) {
      invoiceError(e);
    }
  }
}
