import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PermissionGrant } from '../authorization/policy.js';

export interface Principal {
  id: string;
  username: string;
  displayName: string;
  mustChangePassword: boolean;
  sessionId: string;
  csrfToken: string;
  grants: PermissionGrant[];
}

export interface StaffRequest extends IncomingMessage {
  params: Record<string, string>;
  principal?: Principal;
  requestId: string;
}

export type StaffResponse = Pick<ServerResponse, 'setHeader'>;
