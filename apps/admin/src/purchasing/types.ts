export interface SupplierInput {
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  taxReference: string;
  notes: string;
  isActive: boolean;
  expectedVersion?: number;
}
export interface Supplier extends Omit<SupplierInput, 'expectedVersion'> {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface OrderInput {
  supplierId: string;
  locationId: string;
  expectedOn: string | null;
  reference: string;
  notes: string;
  lines: { variantId: string; quantity: string; unitCost: string }[];
  expectedVersion?: number;
}
export interface OrderLine {
  variantId: string;
  sku: string;
  productName: string;
  attributes: Record<string, string>;
  quantity: string;
  unitCost: string;
  lineTotal: string;
}
export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  status: 'draft' | 'issued' | 'cancelled';
  currency: 'BDT';
  expectedOn: string | null;
  reference: string;
  notes: string;
  total: string;
  version: number;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string;
  supplierSnapshot: Record<string, unknown>;
  lines: OrderLine[];
  createdAt: string;
  updatedAt: string;
}
export interface PageQuery {
  search: string;
  status: string;
  page: number;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PurchaseVariant {
  variantId: string;
  sku: string;
  productName: string;
  attributes: Record<string, string>;
}
export interface PurchaseLocation {
  id: string;
  code: string;
  name: string;
}
