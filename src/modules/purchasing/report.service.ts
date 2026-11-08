import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { Principal } from '../identity/http.types.js';
import { permits } from '../authorization/policy.js';
import { escapeSearch } from './purchasing.store.js';
import { decimal, invalid } from './purchasing.validation.js';
import type { PaymentSupplier } from './payment.types.js';
import type {
  AgingAmounts,
  AgingReport,
  AgingQuery,
  StatementQuery,
  SupplierStatement,
  StatementEvent,
  StatementInvoice,
} from './report.types.js';
import {
  openInvoicesSql,
  bucketColumns,
  statementEventsSql,
  statementEventSelect,
} from './report.sql.js';
export function reportMoney(value: string): string {
  const n = BigInt(value);
  return n < 0n ? '-' + decimal(-n) : decimal(n);
}
function amounts<T extends AgingAmounts>(row: T): T {
  return {
    ...row,
    ...Object.fromEntries(
      ['outstanding', 'notDue', 'days1to30', 'days31to60', 'days61to90', 'over90'].map((k) => [
        k,
        reportMoney(row[k as keyof AgingAmounts]),
      ]),
    ),
  };
}
type StoredEvent = Omit<StatementEvent, 'recordedAt'> & { recordedAt: Date | string };
export class PayablesReportService {
  constructor(private readonly source: Pick<DataSource, 'transaction'>) {}
  private allow(user: Principal) {
    if (!permits(user.grants, 'payables.read') || !permits(user.grants, 'purchasing.read'))
      throw new ForbiddenException({ code: 'REPORT_PERMISSION' });
  }
  private async context(m: EntityManager) {
    const row = (
      await m.query(
        `SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS today,CURRENT_TIMESTAMP AS generated`,
      )
    )[0];
    return { today: row.today as string, generatedAt: new Date(row.generated).toISOString() };
  }
  private day(date: string, today: string) {
    if (date > today) invalid('Report date cannot be later than today in Bangladesh');
    return date;
  }
  private async verify(m: EntityManager, asOf: string, supplierId?: string) {
    const rows = await m.query(
      openInvoicesSql(!!supplierId) +
        ` SELECT EXISTS(SELECT 1 FROM open_invoices WHERE remaining_minor<0 OR paid_minor<0) OR EXISTS(SELECT 1 FROM supplier_payments p CROSS JOIN cutoff c WHERE p.created_at<c.until AND(p.reversed_at IS NULL OR p.reversed_at>=c.until) ${supplierId ? 'AND p.supplier_id=$2' : ''} AND(p.amount_minor<>coalesce((SELECT sum(a.amount_minor) FROM supplier_payment_allocations a WHERE a.payment_id=p.id),0) OR EXISTS(SELECT 1 FROM supplier_payment_allocations a JOIN supplier_invoices i ON i.id=a.invoice_id WHERE a.payment_id=p.id AND(i.supplier_id<>p.supplier_id OR i.created_at>=c.until OR i.reversed_at<c.until)))) AS invalid`,
      supplierId ? [asOf, supplierId] : [asOf],
    );
    if (rows[0]?.invalid) throw new ServiceUnavailableException({ code: 'REPORT_RECONCILIATION' });
  }
  async aging(query: AgingQuery, user: Principal): Promise<AgingReport> {
    this.allow(user);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const ctx = await this.context(m),
        asOf = this.day(query.asOf ?? ctx.today, ctx.today),
        base =
          openInvoicesSql() +
          `,rollup AS(SELECT supplier_id,count(*)::int AS "invoiceCount",${bucketColumns} FROM open_invoices WHERE remaining_minor>0 GROUP BY supplier_id),suppliers AS(SELECT s.id,s.code,s.name,s.is_active AS "isActive",r.* FROM rollup r JOIN purchasing_suppliers s ON s.id=r.supplier_id WHERE s.name ILIKE $2 ESCAPE '\\' OR s.code ILIKE $2 ESCAPE '\\')`,
        args = [asOf, escapeSearch(query.search)];
      await this.verify(m, asOf);
      const totals = (
        await m.query(
          base +
            ` SELECT count(*)::int AS "supplierCount",coalesce(sum("invoiceCount"),0)::int AS "invoiceCount",coalesce(sum(outstanding::numeric),0)::text AS outstanding,coalesce(sum("notDue"::numeric),0)::text AS "notDue",coalesce(sum("days1to30"::numeric),0)::text AS "days1to30",coalesce(sum("days31to60"::numeric),0)::text AS "days31to60",coalesce(sum("days61to90"::numeric),0)::text AS "days61to90",coalesce(sum("over90"::numeric),0)::text AS "over90" FROM suppliers`,
          args,
        )
      )[0];
      const rows = await m.query(
        base +
          ' SELECT id,code,name,"isActive","invoiceCount",outstanding,"notDue","days1to30","days31to60","days61to90","over90" FROM suppliers ORDER BY outstanding::numeric DESC,name,id LIMIT 20 OFFSET $3',
        [...args, (query.page - 1) * 20],
      );
      return {
        ...ctx,
        asOf,
        currency: 'BDT',
        totals: amounts(totals),
        items: rows.map(amounts),
        total: totals.supplierCount,
        page: query.page,
        pageSize: 20,
      };
    });
  }
  async statement(
    id: string,
    query: StatementQuery,
    user: Principal,
    exporting = false,
  ): Promise<SupplierStatement> {
    this.allow(user);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const ctx = await this.context(m),
        to = this.day(query.to ?? ctx.today, ctx.today),
        from = query.from ?? to.slice(0, 8) + '01';
      if (from > to) invalid('Statement start date must not follow its end date');
      const supplier: PaymentSupplier | undefined = (
        await m.query(
          'SELECT id,code,name,is_active AS "isActive" FROM purchasing_suppliers WHERE id=$1',
          [id],
        )
      )[0];
      if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND' });
      await this.verify(m, to, id);
      const args = [id, from, to],
        ledger = (
          await m.query(
            statementEventsSql +
              ` SELECT coalesce(sum(delta) FILTER(WHERE recorded_at<b.since),0)::text AS opening,coalesce(sum(greatest(delta,0)) FILTER(WHERE recorded_at>=b.since),0)::text AS increased,coalesce(sum(greatest(-delta,0)) FILTER(WHERE recorded_at>=b.since),0)::text AS decreased,coalesce(sum(delta),0)::text AS closing,count(*) FILTER(WHERE recorded_at>=b.since)::int AS total FROM history CROSS JOIN bounds b`,
            args,
          )
        )[0];
      if (exporting && ledger.total > 5000)
        throw new ConflictException({ code: 'REPORT_EXPORT_TOO_LARGE' });
      const balances = (
        await m.query(
          openInvoicesSql(true) +
            ` SELECT coalesce(sum(total_minor),0)::text AS "invoiceTotal",coalesce(sum(paid_minor),0)::text AS paid,count(*) FILTER(WHERE remaining_minor>0)::int AS count,${bucketColumns} FROM open_invoices`,
          [to, id],
        )
      )[0];
      if (
        BigInt(ledger.closing) !== BigInt(balances.outstanding) ||
        BigInt(ledger.opening) + BigInt(ledger.increased) - BigInt(ledger.decreased) !==
          BigInt(ledger.closing)
      )
        throw new ServiceUnavailableException({ code: 'REPORT_RECONCILIATION' });
      const rows: StoredEvent[] = await m.query(
        statementEventsSql + statementEventSelect + ' LIMIT $4 OFFSET $5',
        [...args, exporting ? 5000 : 20, exporting ? 0 : (query.page - 1) * 20],
      );
      const invoices: StatementInvoice[] = await m.query(
        openInvoicesSql(true) +
          ' SELECT i.id,i.number,o.number AS "orderNumber",i.invoice_on::text AS "invoiceOn",i.due_on::text AS "dueOn",i.total_minor::text AS total,i.paid_minor::text AS paid,i.remaining_minor::text AS remaining,greatest(i.days_overdue,0) AS "daysOverdue" FROM open_invoices i JOIN purchase_orders o ON o.id=i.order_id WHERE i.remaining_minor>0 ORDER BY i.due_on,i.id LIMIT 25 OFFSET $3',
        [to, id, (query.invoicePage - 1) * 25],
      );
      return {
        ...ctx,
        supplier,
        from,
        to,
        currency: 'BDT',
        totals: {
          ...amounts(balances),
          opening: reportMoney(ledger.opening),
          increased: reportMoney(ledger.increased),
          decreased: reportMoney(ledger.decreased),
          closing: reportMoney(ledger.closing),
          invoiceTotal: reportMoney(balances.invoiceTotal),
          paid: reportMoney(balances.paid),
        },
        items: rows.map((e) => ({
          ...e,
          recordedAt: new Date(e.recordedAt).toISOString(),
          increase: reportMoney(e.increase),
          decrease: reportMoney(e.decrease),
          balanceAtTime: reportMoney(e.balanceAtTime),
        })),
        total: ledger.total,
        page: exporting ? 1 : query.page,
        pageSize: exporting ? 5000 : 20,
        invoices: invoices.map((i) => ({
          ...i,
          total: reportMoney(i.total),
          paid: reportMoney(i.paid),
          remaining: reportMoney(i.remaining),
        })),
        invoicesTotal: balances.count,
        invoicePage: query.invoicePage,
        invoicePageSize: 25,
      };
    });
  }
}
