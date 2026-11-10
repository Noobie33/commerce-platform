export interface Grant {
  code: string;
  locationId: string | null;
}
export interface Profile {
  id: string;
  username: string;
  displayName: string;
  mustChangePassword: boolean;
  grants: Grant[];
  csrfToken: string;
}
export interface TeamMember {
  onboardingState?: string | null;
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
}

export type WorkspacePage =
  'sales' | 'customers' | 'purchasing' | 'overview' | 'inventory' | 'catalog' | 'team' | 'profile';
