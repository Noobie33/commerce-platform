import type { Profile, TeamMember } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(
      status === 429
        ? 'Too many attempts. Please wait before trying again.'
        : status === 401
          ? 'Your sign-in details could not be verified.'
          : status === 403
            ? 'This action is not available for your account.'
            : status === 503
              ? 'The workspace is temporarily unavailable. Please try again.'
              : status === 400
                ? 'Please check the information you entered.'
                : 'Something went wrong. Please try again.',
    );
  }
}

export class StaffApi {
  private csrf = '';
  private authenticated = false;
  onSessionExpired: (() => void) | undefined;
  onPasswordChangeRequired: (() => void) | undefined;

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const writing = body !== undefined;
    let response: Response;
    try {
      response = await fetch('/api/v1' + path, {
        method: writing ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: writing
          ? {
              'Content-Type': 'application/json',
              'X-Requested-With': 'commerce-staff',
              'X-CSRF-Token': this.csrf,
            }
          : { Accept: 'application/json' },
        ...(writing ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('Unable to reach your workspace. Check the connection and try again.');
    }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
          ? data.code
          : undefined;
      if (
        response.status === 401 &&
        !['/auth/login', '/auth/password'].includes(path) &&
        this.authenticated
      ) {
        this.forget();
        this.onSessionExpired?.();
      }
      if (code === 'PASSWORD_CHANGE_REQUIRED') this.onPasswordChangeRequired?.();
      throw new ApiError(response.status, code);
    }
    return data as T;
  }

  forget() {
    this.csrf = '';
    this.authenticated = false;
  }
  async me() {
    const profile = await this.request<Profile>('/staff/me');
    if (!profile || !Array.isArray(profile.grants) || typeof profile.csrfToken !== 'string')
      throw new Error('The workspace returned an unexpected response.');
    this.csrf = profile.csrfToken;
    this.authenticated = true;
    return profile;
  }
  async login(username: string, password: string) {
    const result = await this.request<{ csrfToken: string }>('/auth/login', { username, password });
    this.csrf = result.csrfToken;
    this.authenticated = true;
    return this.me();
  }
  async logout() {
    await this.request('/auth/logout', {});
    this.forget();
  }
  async changePassword(currentPassword: string, newPassword: string) {
    await this.request('/auth/password', { currentPassword, newPassword });
    this.forget();
  }
  team() {
    return this.request<TeamMember[]>('/staff');
  }
  async ready() {
    try {
      const response = await fetch('/api/v1/health/ready', {
        credentials: 'omit',
        cache: 'no-store',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
