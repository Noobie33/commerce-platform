export type AccessKind = 'staff' | 'role';
export interface Assignment {
  roleId: string;
  locationId: string | null;
}
export interface AccessInput {
  kind: AccessKind;
  id: string;
  expectedVersion: number;
  active: boolean;
  reason: string;
  displayName?: string;
  assignments?: Assignment[];
  code?: string;
  label?: string;
  permissions?: string[];
}
export interface AccessRecord {
  id: string;
  version: number;
  active: boolean;
  protected: boolean;
  assignedStaffCount?: number;
  username?: string;
  displayName?: string;
  assignments?: (Assignment & { roleLabel?: string; locationLabel?: string | null })[];
  code?: string;
  label?: string;
  permissions?: string[];
}
export interface AccessPage {
  items: AccessRecord[];
  total: number;
  page: number;
}
export interface AccessView {
  record: AccessRecord;
  history: {
    version: number;
    reason: string;
    actorName: string;
    createdAt: string;
    revokedSessions: number;
    snapshot: AccessRecord;
    before: AccessRecord | null;
  }[];
  page: number;
  hasMore: boolean;
}
export interface AccessChoice {
  id: string;
  label: string;
  locationCompatible: boolean;
}
