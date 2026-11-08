import type { MediaResult, Category, Product, ProductPage, ProductPayload } from './catalog/types';
import type { Profile, TeamMember } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    validationMessage?: string,
  ) {
    super(
      (code === 'INVALID_CATALOG_INPUT' && validationMessage && validationMessage.length < 240
        ? validationMessage
        : '') ||
        (code &&
          (
            {
              INVALID_PRODUCT_IMAGE:
                'Choose a valid, non-animated JPEG, PNG or WebP image up to 5 MB and 16 megapixels.',
              PHOTO_LIMIT:
                'This product already has eight photos. Remove one before uploading another.',
              MEDIA_BUSY: 'Image processing is busy. Please try again shortly.',
              INVALID_MEDIA_VERSION: 'Reload the latest product before changing photos.',
              STALE_PRODUCT:
                'Someone saved a newer revision. Open the latest product before editing again.',
              SKU_EXISTS: 'This SKU is already in use. Choose a unique SKU.',
              STYLE_CODE_EXISTS: 'This style code is already in use.',
              BARCODE_EXISTS: 'This barcode is already in use.',
              VARIANT_OPTIONS_EXIST: 'Active variants must have different options.',
              CATEGORY_EXISTS: 'This category already exists under the selected parent.',
              IDEMPOTENCY_MISMATCH: 'This save request has changed. Close and reopen the editor.',
            } as Record<string, string>
          )[code]) ||
        (status === 429
          ? 'Too many attempts. Please wait before trying again.'
          : status === 401
            ? 'Your sign-in details could not be verified.'
            : status === 403
              ? 'This action is not available for your account.'
              : status === 503
                ? 'The workspace is temporarily unavailable. Please try again.'
                : status === 400
                  ? 'Please check the information you entered.'
                  : status === 413
                    ? 'This product is too large. Use fewer variants or shorter descriptions.'
                    : 'Something went wrong. Please try again.'),
    );
  }
}

export class StaffApi {
  private csrf = '';
  private authenticated = false;
  onSessionExpired: (() => void) | undefined;
  onPasswordChangeRequired: (() => void) | undefined;

  private async request<T>(
    path: string,
    body?: unknown,
    options?: { method?: 'POST' | 'PATCH'; key?: string; image?: File; version?: number },
  ): Promise<T> {
    const writing = body !== undefined;
    let response: Response;
    try {
      response = await fetch('/api/v1' + path, {
        method: writing ? (options?.method ?? 'POST') : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: writing
          ? {
              'Content-Type': options?.image?.type ?? 'application/json',
              ...(options?.image ? { 'X-Product-Version': String(options.version) } : {}),
              'X-Requested-With': 'commerce-staff',
              'X-CSRF-Token': this.csrf,
              ...(options?.key ? { 'X-Idempotency-Key': options.key } : {}),
            }
          : { Accept: 'application/json' },
        ...(writing ? { body: options?.image ?? JSON.stringify(body) } : {}),
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
      throw new ApiError(
        response.status,
        code,
        data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
          ? data.message
          : undefined,
      );
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
  categories() {
    return this.request<Category[]>('/catalog/categories');
  }
  createCategory(name: string, parentId: string | null) {
    return this.request<Category>('/catalog/categories', { name, parentId });
  }
  products(query: { search: string; status: string; categoryId: string; page: number }) {
    const params = new URLSearchParams({
      search: query.search,
      status: query.status,
      page: String(query.page),
      pageSize: '20',
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    });
    return this.request<ProductPage>('/catalog/products?' + params);
  }
  product(id: string) {
    return this.request<Product>('/catalog/products/' + encodeURIComponent(id));
  }
  saveProduct(id: string | null, payload: ProductPayload, key: string) {
    return this.request<Product>(
      '/catalog/products' + (id ? '/' + encodeURIComponent(id) : ''),
      payload,
      { method: id ? 'PATCH' : 'POST', key },
    );
  }
  uploadPhoto(id: string, version: number, file: File, key: string) {
    return this.request<MediaResult>(
      '/catalog/products/' + encodeURIComponent(id) + '/photos',
      {},
      { image: file, version, key },
    );
  }
  changePhoto(
    id: string,
    photoId: string,
    operation: 'primary' | 'remove',
    expectedVersion: number,
    key: string,
  ) {
    return this.request<MediaResult>(
      '/catalog/products/' +
        encodeURIComponent(id) +
        '/photos/' +
        encodeURIComponent(photoId) +
        '/' +
        operation,
      { expectedVersion },
      { key },
    );
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
