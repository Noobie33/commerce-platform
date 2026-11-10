export interface EnrollmentInput {
  action: 'create' | 'reissue' | 'revoke';
  id: string;
  expectedVersion: number;
  reason: string;
  username?: string;
  displayName?: string;
}
export interface EnrollmentRecord {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  version: number;
  state: 'pending' | 'accepted' | 'revoked';
  status: 'pending' | 'expired' | 'accepted' | 'revoked' | 'disabled';
  expiresAt: string;
  activatedAt: string | null;
}
export interface EnrollmentPage {
  items: EnrollmentRecord[];
  total: number;
  page: number;
}
export interface EnrollmentView {
  record: EnrollmentRecord;
  history: {
    version: number;
    action: string;
    reason: string;
    actorName: string;
    createdAt: string;
    state: string;
    expiresAt: string;
  }[];
  page: number;
  hasMore: boolean;
}
export interface EnrollmentResult {
  staffId: string;
  version: number;
  state: string;
  expiresAt: string;
  issued: boolean;
  replayed: boolean;
  activationCode?: string;
  activationUrl: string;
}
