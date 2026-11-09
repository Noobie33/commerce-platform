export interface CustomerAddress {
  line1: string;
  line2: string;
  area: string;
  district: string;
  postalCode: string;
}
export interface CustomerInput {
  customerKind: 'person' | 'business';
  segment: 'retail';
  name: string;
  contactName: string;
  phone: string;
  email: string;
  billingAddress: CustomerAddress | null;
  deliveryAddress: CustomerAddress | null;
  notes: string;
  isActive: boolean;
  expectedVersion?: number;
}
export interface Customer extends Omit<CustomerInput, 'expectedVersion' | 'segment'> {
  // Historical records retain their original classification; new writes are retail-only.
  segment: 'retail' | 'wholesale' | 'both';
  id: string;
  code: string;
  version: number;
  creditEnabled: boolean;
  creditLimit: string;
  paymentTermsDays: number;
  createdAt: string;
  updatedAt: string;
}
export interface CustomerPage {
  items: Customer[];
  page: number;
  total: number;
  pageSize: number;
}
export interface CustomerResult {
  id: string;
  version: number;
  kind: string;
}
export interface CreditPolicy {
  creditEnabled: boolean;
  creditLimitMinor: string;
  paymentTermsDays: number;
}
export interface CreditHistory {
  items: {
    id: string;
    version: number;
    previousPolicy: CreditPolicy;
    currentPolicy: CreditPolicy;
    reason: string;
    actorName: string;
    createdAt: string;
  }[];
  page: number;
  total: number;
  pageSize: number;
}
