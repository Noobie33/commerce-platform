export interface InvoiceInput {
  kind: 'post';
  orderId: string;
  expectedRevision: number;
  number: string;
  invoiceOn: string;
  dueOn: string;
  tax: string;
  delivery: string;
  discount: string;
  reason: string;
  lines: { receiptId: string; orderLineId: string; quantity: string; unitCost: string }[];
}
export interface InvoiceReverseInput {
  kind: 'reverse';
  invoiceId: string;
  expectedRevision: number;
  reason: string;
}
export interface InvoiceResult {
  invoiceId: string;
  orderId: string;
  invoiceRevision: number;
  kind: 'post' | 'reverse';
}
export interface InvoiceLine {
  receiptId: string;
  orderLineId: string;
  sku: string;
  productName: string;
  reference: string;
  receivedAt: string;
  received: string;
  invoiced: string;
  remaining: string;
  unitCost: string;
}
export interface SupplierInvoice {
  id: string;
  orderId: string;
  orderNumber: string;
  supplierName: string;
  number: string;
  invoiceOn: string;
  dueOn: string;
  goods: string;
  tax: string;
  delivery: string;
  discount: string;
  total: string;
  reason: string;
  createdAt: string;
  actorName: string;
  reversedAt: string | null;
  reversalReason: string;
  lines: {
    receiptId: string;
    sku: string;
    productName: string;
    quantity: string;
    unitCost: string;
    lineTotal: string;
  }[];
}
export interface InvoicePage {
  orderId: string;
  orderNumber: string;
  supplierName: string;
  invoiceRevision: number;
  canPost: boolean;
  canReverse: boolean;
  lines: InvoiceLine[];
  linesTotal: number;
  linePage: number;
  items: SupplierInvoice[];
  total: number;
  page: number;
  pageSize: number;
  unsettled: string;
}
export interface InvoiceList {
  items: SupplierInvoice[];
  total: number;
  page: number;
  pageSize: number;
  unsettled: string;
}
