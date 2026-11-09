export type PostingKind = 'opening' | 'receipt' | 'adjustment' | 'transfer';
export interface StockLine {
  variantId: string;
  quantity: string;
}
export interface StockInput {
  kind: PostingKind;
  locationId: string;
  destinationId: string | null;
  reason: string;
  reference: string;
  lines: StockLine[];
}
export interface ReversalInput {
  kind: 'reversal';
  reversalOf: string;
  reason: string;
  reference: string;
}
export interface InventoryLocation {
  id: string;
  code: string;
  name: string;
  kind: 'warehouse' | 'store';
  canReceive: boolean;
  canAdjust: boolean;
  canTransfer: boolean;
}
export interface StockRow {
  reserved: string;
  available: string;
  variantId: string;
  sku: string;
  productName: string;
  styleCode: string;
  attributes: Record<string, string>;
  isActive: boolean;
  productStatus: string;
  quantity: string;
}
export interface StockPage {
  items: StockRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: { recordedSkus: number; positiveSkus: number; zeroSkus: number; units: string };
}
export interface MovementLine {
  variantId: string;
  locationId?: string;
  sku: string;
  productName: string;
  delta: string;
  quantityBefore: string;
  quantityAfter: string;
}
export interface StockPosting {
  id: string;
  kind: PostingKind | 'reversal';
  locationId: string;
  destinationId: string | null;
  reversalOf: string | null;
  reason: string;
  reference: string;
  createdAt: string;
  lines: MovementLine[];
}
export interface HistoryRow {
  id: string;
  kind: StockPosting['kind'];
  reason: string;
  reference: string;
  createdAt: string;
  actorName: string;
  reversalOf: string | null;
  reversedBy: string | null;
  canReverse: boolean;
  isPurchaseReceipt: boolean;
  lines: MovementLine[];
}
export interface InventoryQuery {
  search: string;
  page: number;
  pageSize: number;
  stock: 'all' | 'positive' | 'zero';
  variantId: string | null;
}

export interface ReversalPreview extends MovementLine {
  reserved: string;
  locationId: string;
  locationName: string;
}
