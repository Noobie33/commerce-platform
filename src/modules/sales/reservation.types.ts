export interface ReservationInput {
  expectedVersion: number;
  expectedRevision: number;
  reason: string;
  holdMinutes?: number;
  reservationId?: string;
}
export interface ReservationRecord {
  id: string;
  orderId: string;
  orderVersion: number;
  locationId: string;
  locationName: string;
  actorName: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeKind: string | null;
  closeReason: string;
  status: 'active' | 'expired' | 'released';
  canRelease: boolean;
  lines: { variantId: string; sku: string; productName: string; quantity: string }[];
}
export interface ReservationPage {
  visible: boolean;
  canManage: boolean;
  revision: number;
  asOf: string;
  current: ReservationRecord | null;
  items: ReservationRecord[];
  page: number;
  pageSize: number;
  total: number;
  lines: {
    variantId: string;
    sku: string;
    quantity: string;
    onHand: string;
    reserved: string;
    available: string;
  }[];
}
export interface ReservationResult {
  id: string;
  orderId: string;
  revision: number;
  orderVersion: number;
  kind: string;
}
