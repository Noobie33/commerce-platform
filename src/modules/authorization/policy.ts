export interface PermissionGrant {
  code: string;
  locationId: string | null;
}

export function permits(
  grants: readonly PermissionGrant[],
  code: string,
  locationId?: string,
): boolean {
  return grants.some(
    (grant) =>
      grant.code === code &&
      (grant.locationId === null || (locationId !== undefined && grant.locationId === locationId)),
  );
}
