import { object, version, uuid, text, money, minor, invalid } from './purchasing.validation.js';
import type { InvoiceInput, InvoiceReverseInput } from './invoice.types.js';
function date(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v < '2000-01-01' ||
    v > '2199-12-31' ||
    !Number.isFinite(new Date(v + 'T00:00:00Z').getTime()) ||
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v
  )
    invalid('Choose a valid invoice or due date');
  return v;
}
export function invoiceInput(id: unknown, value: unknown): InvoiceInput {
  const r = object(value, [
    'expectedRevision',
    'number',
    'invoiceOn',
    'dueOn',
    'tax',
    'delivery',
    'discount',
    'reason',
    'lines',
  ]);
  const invoiceOn = date(r.invoiceOn),
    dueOn = date(r.dueOn);
  if (dueOn < invoiceOn) invalid('Due date cannot precede invoice date');
  if (!Array.isArray(r.lines) || r.lines.length < 1 || r.lines.length > 25)
    invalid('Include 1–25 received lines');
  const seen = new Set<string>();
  let goods = 0n;
  const lines = r.lines
    .map((value) => {
      const l = object(value, ['receiptId', 'orderLineId', 'quantity', 'unitCost']),
        receiptId = uuid(l.receiptId),
        orderLineId = uuid(l.orderLineId),
        key = receiptId + orderLineId;
      if (seen.has(key)) invalid('Include each receipt line once');
      seen.add(key);
      if (typeof l.quantity !== 'string' || !/^[1-9]\d{0,8}$/.test(l.quantity))
        invalid('Use positive whole-piece quantities');
      const unitCost = minor(money(l.unitCost)).toString();
      goods += BigInt(l.quantity) * BigInt(unitCost);
      return { receiptId, orderLineId, quantity: l.quantity, unitCost };
    })
    .sort((a, b) => (a.receiptId + a.orderLineId).localeCompare(b.receiptId + b.orderLineId));
  const tax = minor(money(r.tax)),
    delivery = minor(money(r.delivery)),
    discount = minor(money(r.discount));
  if (
    discount > goods ||
    goods > 99999999999999n ||
    goods + tax + delivery - discount < 1n ||
    goods + tax + delivery - discount > 99999999999999n
  )
    invalid('Check invoice quantities, amounts and discount');
  return {
    kind: 'post',
    orderId: uuid(id),
    expectedRevision: version(r.expectedRevision),
    number: text(r.number, 'supplier invoice number', 100),
    invoiceOn,
    dueOn,
    tax: tax.toString(),
    delivery: delivery.toString(),
    discount: discount.toString(),
    reason: text(r.reason, 'invoice reason', 500),
    lines,
  };
}
export function reverseInvoiceInput(id: unknown, value: unknown): InvoiceReverseInput {
  const r = object(value, ['expectedRevision', 'reason']);
  return {
    kind: 'reverse',
    invoiceId: uuid(id),
    expectedRevision: version(r.expectedRevision),
    reason: text(r.reason, 'reversal reason', 500),
  };
}
export function invoicePages(value: unknown) {
  const r = object(value, ['page', 'linePage']);
  const page = (v: unknown) => {
    if (v === undefined) return 1;
    if (typeof v !== 'string' || !/^[1-9]\d*$/.test(v) || Number(v) > 10000)
      invalid('Invalid invoice page');
    return Number(v);
  };
  return { page: page(r.page), linePage: page(r.linePage) };
}
