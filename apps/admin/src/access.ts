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
