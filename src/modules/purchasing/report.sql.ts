// All cutoff days are Bangladesh calendar days, with an exclusive next-day boundary.
// Recorded timestamps define history; invoice/payment document dates are shown separately.
export function openInvoicesSql(supplier = false) {
  return `WITH cutoff AS(SELECT (($1::date+1)::timestamp AT TIME ZONE 'Asia/Dhaka') AS until),
 paid AS(SELECT a.invoice_id,sum(a.amount_minor) AS paid FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id CROSS JOIN cutoff c WHERE p.created_at<c.until AND(p.reversed_at IS NULL OR p.reversed_at>=c.until) ${supplier ? 'AND p.supplier_id=$2' : ''} GROUP BY a.invoice_id),
 open_invoices AS(SELECT i.id,i.supplier_id,i.order_id,i.number,i.invoice_on,i.due_on,i.total_minor,coalesce(p.paid,0) AS paid_minor,i.total_minor-coalesce(p.paid,0) AS remaining_minor,($1::date-i.due_on) AS days_overdue FROM supplier_invoices i LEFT JOIN paid p ON p.invoice_id=i.id CROSS JOIN cutoff c WHERE i.created_at<c.until AND(i.reversed_at IS NULL OR i.reversed_at>=c.until) ${supplier ? 'AND i.supplier_id=$2' : ''})`;
}
export const bucketColumns = `coalesce(sum(remaining_minor),0)::text AS outstanding,
coalesce(sum(remaining_minor) FILTER(WHERE days_overdue<=0),0)::text AS "notDue",
coalesce(sum(remaining_minor) FILTER(WHERE days_overdue BETWEEN 1 AND 30),0)::text AS "days1to30",
coalesce(sum(remaining_minor) FILTER(WHERE days_overdue BETWEEN 31 AND 60),0)::text AS "days31to60",
coalesce(sum(remaining_minor) FILTER(WHERE days_overdue BETWEEN 61 AND 90),0)::text AS "days61to90",
coalesce(sum(remaining_minor) FILTER(WHERE days_overdue>90),0)::text AS "over90"`;
export const statementEventsSql = `WITH bounds AS(SELECT($2::date::timestamp AT TIME ZONE 'Asia/Dhaka') AS since,(($3::date+1)::timestamp AT TIME ZONE 'Asia/Dhaka') AS until),
 events AS(
 SELECT 'invoice:'||i.id AS id,'invoice'::text AS kind,i.id AS source_id,i.number AS reference,i.created_at AS recorded_at,i.invoice_on AS document_on,i.reason,u.display_name AS actor_name,i.total_minor::numeric AS delta FROM supplier_invoices i JOIN staff_users u ON u.id=i.actor_id WHERE i.supplier_id=$1
 UNION ALL SELECT 'invoice_reversal:'||i.id,'invoice_reversal',i.id,i.number,i.reversed_at,i.invoice_on,i.reversal_reason,u.display_name,-i.total_minor::numeric FROM supplier_invoices i JOIN staff_users u ON u.id=i.reversed_by WHERE i.supplier_id=$1 AND i.reversed_at IS NOT NULL
 UNION ALL SELECT 'payment:'||p.id,'payment',p.id,p.reference,p.created_at,p.paid_on,p.reason,u.display_name,-p.amount_minor::numeric FROM supplier_payments p JOIN staff_users u ON u.id=p.actor_id WHERE p.supplier_id=$1
 UNION ALL SELECT 'payment_reversal:'||p.id,'payment_reversal',p.id,p.reference,p.reversed_at,p.paid_on,p.reversal_reason,u.display_name,p.amount_minor::numeric FROM supplier_payments p JOIN staff_users u ON u.id=p.reversed_by WHERE p.supplier_id=$1 AND p.reversed_at IS NOT NULL),
 history AS(SELECT e.* FROM events e CROSS JOIN bounds b WHERE e.recorded_at<b.until),
 timeline AS(SELECT h.*,sum(delta) OVER(ORDER BY recorded_at RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_at_time,count(*) OVER(PARTITION BY recorded_at)::int AS same_time_events FROM history h)`;
export const statementEventSelect = ` SELECT t.id,t.kind,t.source_id AS "sourceId",t.reference,t.recorded_at AS "recordedAt",to_char(t.recorded_at AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS "recordedOn",t.document_on::text AS "documentOn",t.reason,t.actor_name AS "actorName",greatest(t.delta,0)::text AS increase,greatest(-t.delta,0)::text AS decrease,t.balance_at_time::text AS "balanceAtTime",t.same_time_events AS "sameTimeEvents" FROM timeline t CROSS JOIN bounds b WHERE t.recorded_at>=b.since ORDER BY t.recorded_at,t.id`;
