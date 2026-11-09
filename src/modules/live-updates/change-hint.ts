import type { PermissionGrant } from '../authorization/policy.js';
import { permits } from '../authorization/policy.js';
export type ChangeTopic =
  | 'catalog'
  | 'customers'
  | 'purchasing'
  | 'sales'
  | 'inventory'
  | 'locations'
  | 'reservations'
  | 'access';
export interface ChangeHint {
  topic: ChangeTopic;
  locationId?: string;
}
export function parseHint(payload: string): ChangeHint | null {
  try {
    const x: unknown = JSON.parse(payload);
    if (!x || typeof x !== 'object' || !('topic' in x)) return null;
    const topic = x.topic;
    if (
      ![
        'catalog',
        'customers',
        'purchasing',
        'sales',
        'inventory',
        'locations',
        'reservations',
        'access',
      ].includes(String(topic))
    )
      return null;
    if (['inventory', 'locations', 'reservations'].includes(String(topic))) {
      if (
        !('locationId' in x) ||
        typeof x.locationId !== 'string' ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(x.locationId)
      )
        return null;
      return { topic: topic as ChangeTopic, locationId: x.locationId };
    }
    return { topic: topic as ChangeTopic };
  } catch {
    return null;
  }
}
// The browser receives only these coarse topic names, never scope IDs or row data.
export function permittedTopics(
  hints: readonly ChangeHint[],
  grants: readonly PermissionGrant[],
): string[] {
  const topics = new Set<string>();
  for (const h of hints) {
    if (h.topic === 'access') {
      topics.add('all');
      continue;
    }
    if (h.topic === 'catalog' && permits(grants, 'catalog.read')) topics.add('catalog');
    if (h.topic === 'customers' && permits(grants, 'customers.read')) topics.add('customers');
    if (
      h.topic === 'purchasing' &&
      (permits(grants, 'purchasing.read') || permits(grants, 'payables.read'))
    )
      topics.add('purchasing');
    if (h.topic === 'sales' && permits(grants, 'sales.read')) topics.add('sales');
    if (h.topic === 'reservations') {
      if (permits(grants, 'sales.read')) topics.add('sales');
      if (permits(grants, 'inventory.read', h.locationId)) topics.add('inventory');
    }
    if (h.topic === 'inventory' && permits(grants, 'inventory.read', h.locationId))
      topics.add('inventory');
    if (h.topic === 'locations') {
      if (permits(grants, 'inventory.read', h.locationId) || permits(grants, 'locations.manage'))
        topics.add('inventory');
      if (permits(grants, 'purchasing.read')) topics.add('purchasing');
      if (permits(grants, 'sales.read')) topics.add('sales');
    }
  }
  if (hints.some((h) => h.topic === 'access') && permits(grants, 'staff.read')) topics.add('team');
  return [...topics];
}
