import type { PaymentSupplier } from './payment-types';
export interface AgingAmounts {
  outstanding: string;
  notDue: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  over90: string;
}
export interface AgingSupplier extends PaymentSupplier, AgingAmounts {
  invoiceCount: number;
}
export interface AgingReport {
  asOf: string;
  today: string;
  generatedAt: string;
  currency: 'BDT';
  totals: AgingAmounts & { supplierCount: number; invoiceCount: number };
  items: AgingSupplier[];
  total: number;
  page: number;
  pageSize: number;
}
export interface StatementEvent {
  id: string;
  kind: 'invoice' | 'invoice_reversal' | 'payment' | 'payment_reversal';
  sourceId: string;
  reference: string;
  recordedAt: string;
  recordedOn: string;
  documentOn: string;
  reason: string;
  actorName: string;
  increase: string;
  decrease: string;
  balanceAtTime: string;
  sameTimeEvents: number;
}
export interface StatementInvoice {
  id: string;
  number: string;
  orderNumber: string;
  invoiceOn: string;
  dueOn: string;
  total: string;
  paid: string;
  remaining: string;
  daysOverdue: number;
}
export interface SupplierStatement {
  supplier: PaymentSupplier;
  from: string;
  to: string;
  today: string;
  generatedAt: string;
  currency: 'BDT';
  totals: AgingAmounts & {
    opening: string;
    increased: string;
    decreased: string;
    closing: string;
    invoiceTotal: string;
    paid: string;
  };
  items: StatementEvent[];
  total: number;
  page: number;
  pageSize: number;
  invoices: StatementInvoice[];
  invoicesTotal: number;
  invoicePage: number;
  invoicePageSize: number;
}
export interface AgingQuery {
  asOf?: string;
  search: string;
  page: number;
}
export interface StatementQuery {
  from?: string;
  to?: string;
  page: number;
  invoicePage: number;
}
