export interface SalesCustomer {
  id: string;
  code: string;
  name: string;
  version: number;
  segment: 'retail' | 'wholesale' | 'both';
}
export interface SalesLocation {
  id: string;
  code: string;
  name: string;
}
export interface SalesVariant {
  variantId: string;
  sku: string;
  productName: string;
  attributes: Record<string, string>;
  catalogPrice: string;
}
export interface SalesLine extends SalesVariant {
  quantity: string;
  unitPrice: string;
  priceMode: 'catalog' | 'override';
  lineTotal: string;
}
export interface SalesInput {
  customerId: string;
  customerVersion: number;
  locationId: string;
  channel: 'retail';
  fulfillOn: string | null;
  reference: string;
  notes: string;
  priceReason: string;
  lines: {
    variantId: string;
    quantity: string;
    unitPrice: string;
    priceMode: 'catalog';
  }[];
  expectedVersion?: number;
}
export interface SalesOrder {
  stockReserved: boolean;
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerSnapshot: SalesCustomer & {
    customerKind: string;
    contactName: string;
    phone: string;
    email: string;
    billingAddress: Record<string, string> | null;
    deliveryAddress: Record<string, string> | null;
  };
  locationId: string;
  locationName: string;
  channel: 'retail' | 'wholesale';
  status: 'draft' | 'cancelled';
  currency: 'BDT';
  fulfillOn: string | null;
  reference: string;
  notes: string;
  priceReason: string;
  total: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancellationReason: string;
  lines: SalesLine[];
}
export interface SalesPage {
  items: SalesOrder[];
  page: number;
  pageSize: number;
  total: number;
}
export interface SalesResult {
  id: string;
  version: number;
  kind: string;
}
