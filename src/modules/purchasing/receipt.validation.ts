import { object, version, uuid, text, invalid } from './purchasing.validation.js';
import type { ReceiptInput, ReverseReceiptInput } from './receipt.types.js';
export function receiptInput(id: unknown, value: unknown): ReceiptInput {
  const r = object(value, ['expectedRevision', 'reason', 'reference', 'lines']);
  if (!Array.isArray(r.lines) || r.lines.length < 1 || r.lines.length > 25)
    invalid('Include 1–25 ordered SKUs');
  const seen = new Set<string>();
  const lines = r.lines
    .map((value) => {
      const l = object(value, ['orderLineId', 'quantity']),
        orderLineId = uuid(l.orderLineId);
      if (seen.has(orderLineId)) invalid('Include each ordered SKU once');
      seen.add(orderLineId);
      if (typeof l.quantity !== 'string' || !/^[1-9]\d{0,8}$/.test(l.quantity))
        invalid('Use positive whole-piece quantities');
      return { orderLineId, quantity: l.quantity };
    })
    .sort((a, b) => (a.orderLineId < b.orderLineId ? -1 : 1));
  return {
    kind: 'receive',
    orderId: uuid(id),
    expectedRevision: version(r.expectedRevision),
    reason: text(r.reason, 'receipt reason', 500),
    reference: text(r.reference ?? '', 'reference', 100, true),
    lines,
  };
}
export function reverseReceiptInput(id: unknown, value: unknown): ReverseReceiptInput {
  const r = object(value, ['expectedRevision', 'reason', 'reference']);
  return {
    kind: 'reverse',
    receiptId: uuid(id),
    expectedRevision: version(r.expectedRevision),
    reason: text(r.reason, 'reversal reason', 500),
    reference: text(r.reference ?? '', 'reference', 100, true),
  };
}
export function receiptPage(value: unknown) {
  const r = object(value, ['page']);
  if (r.page === undefined) return 1;
  if (typeof r.page !== 'string' || !/^[1-9]\d*$/.test(r.page) || Number(r.page) > 10000)
    invalid('Invalid receipt page');
  return Number(r.page);
}
