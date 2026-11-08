export interface ReceiptLineInput {
  orderLineId: string;
  quantity: string;
}
export interface ReceiptInput {
  kind: 'receive';
  orderId: string;
  expectedRevision: number;
  reason: string;
  reference: string;
  lines: ReceiptLineInput[];
}
export interface ReverseReceiptInput {
  kind: 'reverse';
  receiptId: string;
  expectedRevision: number;
  reason: string;
  reference: string;
}
export interface ReceiptResult {
  receiptId: string;
  orderId: string;
  inventoryPostingId: string;
  receiptRevision: number;
  kind: 'receive' | 'reverse';
}
export interface ReceivingLine {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  ordered: string;
  received: string;
  remaining: string;
}
export interface PurchaseReceipt {
  id: string;
  reason: string;
  reference: string;
  createdAt: string;
  actorName: string;
  inventoryPostingId: string;
  reversedAt: string | null;
  reversalReason: string | null;
  canReverse: boolean;
  lines: { orderLineId: string; sku: string; productName: string; quantity: string }[];
}
export interface ReceivingPage {
  orderId: string;
  orderNumber: string;
  locationId: string;
  locationName: string;
  orderStatus: string;
  receiptRevision: number;
  canReceive: boolean;
  hasActiveReceipts: boolean;
  lines: ReceivingLine[];
  items: PurchaseReceipt[];
  total: number;
  page: number;
  pageSize: number;
}
