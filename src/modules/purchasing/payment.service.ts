import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Principal } from '../identity/http.types.js';
import { permits } from '../authorization/policy.js';
import { escapeSearch } from './purchasing.store.js';
import { decimal } from './purchasing.validation.js';
import { paymentError } from './payment.errors.js';
import type {
  PaymentInput,
  PaymentReverseInput,
  PaymentResult,
  PaymentSupplier,
  PayableInvoice,
  SupplierPayment,
  SupplierPaymentPage,
  PaymentList,
} from './payment.types.js';
const header = `SELECT p.id,p.supplier_id AS "supplierId",p.supplier_name AS "supplierName",p.paid_on::text AS "paidOn",p.method,p.source,p.reference,p.amount_minor::text AS amount,p.reason,u.display_name AS "actorName",p.created_at AS "createdAt",p.reversed_at AS "reversedAt",p.reversal_reason AS "reversalReason",(SELECT jsonb_agg(jsonb_build_object('invoiceId',a.invoice_id,'number',i.number,'orderNumber',o.number,'amount',a.amount_minor::text) ORDER BY i.number,i.id) FROM supplier_payment_allocations a JOIN supplier_invoices i ON i.id=a.invoice_id JOIN purchase_orders o ON o.id=i.order_id WHERE a.payment_id=p.id) AS allocations FROM supplier_payments p JOIN staff_users u ON u.id=p.actor_id`;
type StoredPayment = Omit<SupplierPayment, 'createdAt' | 'reversedAt'> & {
  createdAt: Date | string;
  reversedAt: Date | string | null;
};
function convert(p: StoredPayment): SupplierPayment {
  return {
    ...p,
    amount: decimal(p.amount),
    createdAt: new Date(p.createdAt).toISOString(),
    reversedAt: p.reversedAt ? new Date(p.reversedAt).toISOString() : null,
    allocations: p.allocations.map((a) => ({ ...a, amount: decimal(a.amount) })),
  };
}
export class SupplierPaymentService {
  constructor(private readonly source: DataSource) {}
  private allow(user: Principal) {
    if (!permits(user.grants, 'payables.read') || !permits(user.grants, 'purchasing.read'))
      throw new ForbiddenException({ code: 'PAYMENT_PERMISSION' });
  }
  async suppliers(search: string, user: Principal): Promise<PaymentSupplier[]> {
    this.allow(user);
    return this.source.query(
      `SELECT s.id,s.code,s.name,s.is_active AS "isActive" FROM purchasing_suppliers s WHERE (s.name ILIKE $1 ESCAPE '\\' OR s.code ILIKE $1 ESCAPE '\\') AND EXISTS(SELECT 1 FROM supplier_invoices i WHERE i.supplier_id=s.id) ORDER BY s.name,s.id LIMIT 20`,
      [escapeSearch(search)],
    );
  }
  async list(
    query: { page: number; search: string; status: string },
    user: Principal,
  ): Promise<PaymentList> {
    this.allow(user);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const where = ` WHERE (p.reference ILIKE $1 ESCAPE '\\' OR p.supplier_name ILIKE $1 ESCAPE '\\') AND ($2='all' OR($2='active' AND p.reversed_at IS NULL) OR($2='reversed' AND p.reversed_at IS NOT NULL))`,
        args = [escapeSearch(query.search), query.status],
        counts = (
          await m.query(
            'SELECT count(*)::int AS total,coalesce(sum(p.amount_minor) FILTER(WHERE p.reversed_at IS NULL),0)::text AS recorded FROM supplier_payments p' +
              where,
            args,
          )
        )[0];
      const rows = await m.query(
        header + where + ' ORDER BY p.created_at DESC,p.id DESC LIMIT 20 OFFSET $3',
        [...args, (query.page - 1) * 20],
      );
      return {
        items: rows.map(convert),
        total: counts.total,
        recorded: decimal(counts.recorded),
        page: query.page,
        pageSize: 20,
      };
    });
  }
  async supplier(
    id: string,
    query: { page: number; invoicePage: number },
    user: Principal,
  ): Promise<SupplierPaymentPage> {
    this.allow(user);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const supplier: PaymentSupplier | undefined = (
        await m.query(
          'SELECT id,code,name,is_active AS "isActive" FROM purchasing_suppliers WHERE id=$1',
          [id],
        )
      )[0];
      if (!supplier) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND' });
      const context = (
        await m.query(
          `SELECT coalesce((SELECT version FROM supplier_payment_state WHERE supplier_id=$1),1) AS revision,to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS today`,
          [id],
        )
      )[0];
      const summary = (
        await m.query(
          'SELECT coalesce(sum(i.total_minor),0)::text AS total,coalesce(sum(b.paid_minor),0)::text AS paid,coalesce(sum(b.remaining_minor),0)::text AS remaining FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id WHERE i.supplier_id=$1 AND i.reversed_at IS NULL',
          [id],
        )
      )[0];
      const invoicesTotal = (
        await m.query(
          'SELECT count(*)::int AS n FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id WHERE i.supplier_id=$1 AND i.reversed_at IS NULL AND b.remaining_minor>0',
          [id],
        )
      )[0].n;
      const invoices: PayableInvoice[] = await m.query(
        'SELECT i.id,i.order_id AS "orderId",o.number AS "orderNumber",i.number,i.invoice_on::text AS "invoiceOn",i.due_on::text AS "dueOn",i.total_minor::text AS total,b.paid_minor::text AS paid,b.remaining_minor::text AS remaining FROM supplier_invoices i JOIN supplier_invoice_balances b ON b.invoice_id=i.id JOIN purchase_orders o ON o.id=i.order_id WHERE i.supplier_id=$1 AND i.reversed_at IS NULL AND b.remaining_minor>0 ORDER BY i.due_on,i.id LIMIT 25 OFFSET $2',
        [id, (query.invoicePage - 1) * 25],
      );
      const total = (
          await m.query('SELECT count(*)::int AS n FROM supplier_payments WHERE supplier_id=$1', [
            id,
          ])
        )[0].n,
        items = await m.query(
          header +
            ' WHERE p.supplier_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 20 OFFSET $2',
          [id, (query.page - 1) * 20],
        );
      return {
        supplier,
        paymentRevision: context.revision,
        today: context.today,
        invoiceTotal: decimal(summary.total),
        paid: decimal(summary.paid),
        outstanding: decimal(summary.remaining),
        canRecord: permits(user.grants, 'payables.pay'),
        canReverse: permits(user.grants, 'payables.reverse_payment'),
        invoices: invoices.map((i) => ({
          ...i,
          total: decimal(i.total),
          paid: decimal(i.paid),
          remaining: decimal(i.remaining),
        })),
        invoicesTotal,
        invoicePage: query.invoicePage,
        items: items.map(convert),
        total,
        page: query.page,
        pageSize: 20,
      };
    });
  }
  async post(
    input: PaymentInput | PaymentReverseInput,
    actor: string,
    key: string,
    requestId: string,
  ): Promise<PaymentResult> {
    try {
      return (
        await this.source.query(
          'SELECT public.supplier_payment_post($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS result',
          [key, actor, requestId, JSON.stringify(input)],
        )
      )[0].result;
    } catch (e) {
      paymentError(e);
    }
  }
}
