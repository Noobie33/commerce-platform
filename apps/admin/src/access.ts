import type { Profile } from './types';
export const hasGlobal = (user: Profile, code: string) =>
  user.grants.some((grant) => grant.code === code && grant.locationId === null);
export const canSeeTeam = (user: Profile) => hasGlobal(user, 'staff.read');
export const canSeeCatalog = (user: Profile) => hasGlobal(user, 'catalog.read');
export const permissionNames: Record<string, string> = {
  'staff.read': 'View team',
  'staff.manage': 'Manage staff',
  'roles.manage': 'Manage access',
  'locations.read': 'View locations',
  'audit.read': 'View activity history',
  'catalog.read': 'View catalog',
  'catalog.manage': 'Manage catalog',
};

export const canSeeInventory = (user: Profile) =>
  user.grants.some((g) => g.code === 'inventory.read');
Object.assign(permissionNames, {
  'locations.manage': 'Manage locations',
  'inventory.read': 'View inventory',
  'inventory.receive': 'Receive stock',
  'inventory.adjust': 'Adjust stock',
  'inventory.transfer': 'Transfer stock',
});

export const canSeePurchasing = (user: Profile) => hasGlobal(user, 'purchasing.read');
Object.assign(permissionNames, {
  'payables.pay': 'Record supplier payments',
  'payables.reverse_payment': 'Reverse supplier payments',
  'payables.read': 'View supplier invoices',
  'payables.manage': 'Record supplier invoices',
  'payables.reverse': 'Reverse supplier invoices',
  'purchasing.read': 'View suppliers and purchasing',
  'purchasing.manage': 'Manage suppliers and purchase orders',
});

Object.assign(permissionNames, {
  'purchasing.receive': 'Receive purchase orders',
  'purchasing.reverse_receipt': 'Reverse purchase receipts',
});

Object.assign(permissionNames, {
  'customers.read': 'View customers',
  'customers.manage': 'Manage customers',
  'customers.credit.manage': 'Manage customer credit policy',
});

Object.assign(permissionNames, {
  'sales.read': 'View sales orders and sales customer lookup',
  'sales.manage': 'Manage sales drafts',
  'sales.price_override': 'Override sales prices',
});
