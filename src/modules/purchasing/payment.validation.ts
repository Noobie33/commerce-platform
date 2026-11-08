import { object, uuid, text, version, minor, invalid } from './purchasing.validation.js';
import type { PaymentInput, PaymentReverseInput } from './payment.types.js';
export function paymentMoney(value: unknown) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))
    invalid('Use a positive BDT amount with up to 2 decimal places');
  const n = minor(value);
  if (n < 1n || n > 99999999999999n) invalid('Payment amount is outside the supported range');
  return n.toString();
}
export function paymentDate(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '2000-01-01' ||
    value > '2199-12-31' ||
    !Number.isFinite(new Date(value + 'T00:00:00Z').getTime()) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    invalid('Choose a valid payment date');
  return value;
}
export function paymentInput(id: unknown, value: unknown): PaymentInput {
  const r = object(value, [
    'expectedRevision',
    'paidOn',
    'method',
    'source',
    'reference',
    'amount',
    'reason',
    'allocations',
  ]);
  if (typeof r.method !== 'string' || !['cash', 'bank', 'mobile'].includes(r.method))
    invalid('Choose a payment method');
  if (!Array.isArray(r.allocations) || r.allocations.length < 1 || r.allocations.length > 25)
    invalid('Allocate this payment to 1–25 invoices');
  const seen = new Set<string>();
  let total = 0n;
  const allocations = r.allocations
    .map((v) => {
      const a = object(v, ['invoiceId', 'amount']),
        invoiceId = uuid(a.invoiceId),
        amount = paymentMoney(a.amount);
      if (seen.has(invoiceId)) invalid('Allocate to each invoice once');
      seen.add(invoiceId);
      total += BigInt(amount);
      return { invoiceId, amount };
    })
    .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
  const amount = paymentMoney(r.amount);
  if (total !== BigInt(amount)) invalid('Allocated amounts must equal the recorded payment');
  return {
    kind: 'payment',
    supplierId: uuid(id),
    expectedRevision: version(r.expectedRevision),
    paidOn: paymentDate(r.paidOn),
    method: r.method as PaymentInput['method'],
    source: text(r.source, 'payment source label', 100),
    reference: text(r.reference, 'payment or voucher reference', 100),
    amount,
    reason: text(r.reason, 'payment reason', 500),
    allocations,
  };
}
export function reversePaymentInput(id: unknown, value: unknown): PaymentReverseInput {
  const r = object(value, ['expectedRevision', 'reason']);
  return {
    kind: 'reversePayment',
    paymentId: uuid(id),
    expectedRevision: version(r.expectedRevision),
    reason: text(r.reason, 'payment reversal reason', 500),
  };
}
export function paymentPages(value: unknown) {
  const r = object(value, ['page', 'invoicePage']);
  const page = (v: unknown) => {
    if (v === undefined) return 1;
    if (typeof v !== 'string' || !/^[1-9]\d*$/.test(v) || Number(v) > 10000)
      invalid('Invalid payment page');
    return Number(v);
  };
  return { page: page(r.page), invoicePage: page(r.invoicePage) };
}
