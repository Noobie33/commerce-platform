export interface PaymentInput {
  kind: 'payment';
  supplierId: string;
  expectedRevision: number;
  paidOn: string;
  method: 'cash' | 'bank' | 'mobile';
  source: string;
  reference: string;
  amount: string;
  reason: string;
  allocations: { invoiceId: string; amount: string }[];
}
export interface PaymentReverseInput {
  kind: 'reversePayment';
  paymentId: string;
  expectedRevision: number;
  reason: string;
}
export interface PaymentResult {
  paymentId: string;
  supplierId: string;
  paymentRevision: number;
  kind: 'payment' | 'reversePayment';
}
export interface PaymentSupplier {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface PayableInvoice {
  id: string;
  orderId: string;
  orderNumber: string;
  number: string;
  invoiceOn: string;
  dueOn: string;
  total: string;
  paid: string;
  remaining: string;
}
export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  paidOn: string;
  method: 'cash' | 'bank' | 'mobile';
  source: string;
  reference: string;
  amount: string;
  reason: string;
  actorName: string;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string;
  allocations: { invoiceId: string; number: string; orderNumber: string; amount: string }[];
}
export interface SupplierPaymentPage {
  supplier: PaymentSupplier;
  paymentRevision: number;
  today: string;
  invoiceTotal: string;
  paid: string;
  outstanding: string;
  canRecord: boolean;
  canReverse: boolean;
  invoices: PayableInvoice[];
  invoicesTotal: number;
  invoicePage: number;
  items: SupplierPayment[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PaymentList {
  items: SupplierPayment[];
  total: number;
  page: number;
  pageSize: number;
  recorded: string;
}
