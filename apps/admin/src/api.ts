import type { GalleryView, GalleryInput } from './catalog/gallery-types';
import type { VideoPage, VideoHistory, VideoResult } from './catalog/video-types';
import type {
  EnrollmentInput,
  EnrollmentPage,
  EnrollmentView,
  EnrollmentResult,
} from './pages/onboarding-types';
import type { AccessInput, AccessPage, AccessView, AccessChoice } from './pages/access-types';
import type { PublicationInput, PublicationView } from './catalog/publication-types';
import type { TaxonomyInput, TaxonomyItem, TaxonomyPage } from './catalog/presentation-types';
import type { MerchInput, MerchItem, MerchPage, MerchDefinition } from './catalog/merch-types';
import type { ReadOptions } from './data/live-read';
import type { ContentView, ContentInput, ContentResult } from './catalog/content-types';
import type {
  ReservationPage,
  ReservationInput,
  ReservationResult,
} from './sales/reservation-types';
import type {
  SalesCustomer,
  SalesLocation,
  SalesVariant,
  SalesInput,
  SalesOrder,
  SalesPage,
  SalesResult,
} from './sales/types';
import type {
  Customer,
  CustomerInput,
  CustomerPage,
  CustomerResult,
  CreditHistory,
} from './customers/types';
import type { AgingReport, SupplierStatement } from './purchasing/report-types';
import type {
  PaymentSupplier,
  SupplierPaymentPage,
  PaymentList,
  PaymentResult,
} from './purchasing/payment-types';
import type { InvoicePage, InvoiceResult, InvoiceList } from './purchasing/invoice-types';
import type { ReceivingPage, ReceiptResult } from './purchasing/receipt-types';
import type {
  Supplier,
  SupplierInput,
  PurchaseOrder,
  OrderInput,
  Page,
  PurchaseLocation,
  PurchaseVariant,
} from './purchasing/types';
import type {
  ReversalPreview,
  InventoryLocation,
  StockRow,
  StockPage,
  StockInput,
  StockPosting,
  HistoryRow,
} from './inventory/types';
import type {
  MediaPolicy,
  MediaResult,
  Category,
  Product,
  ProductPage,
  ProductPayload,
} from './catalog/types';
import type { Profile, TeamMember } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    validationMessage?: string,
  ) {
    super(
      ([
        'INVALID_SALES_INPUT',
        'INVALID_CUSTOMER_INPUT',
        'INVALID_CATALOG_INPUT',
        'INVALID_INVENTORY_INPUT',
        'INVALID_PURCHASING_INPUT',
      ].includes(code ?? '') &&
      validationMessage &&
      validationMessage.length < 240
        ? validationMessage
        : '') ||
        (code &&
          (
            {
              INVALID_MERCH_INPUT:
                'Check title, unique size labels, measurement columns and positive decimal values.',
              MERCH_IDENTIFIER_EXISTS:
                'This permanent URL name is already used for this record type.',
              INVALID_PRESENTATION_INPUT:
                'Check category name, URL name, search fields and revision.',
              TAXONOMY_INVALID: 'Check the category and SEO field values.',
              TAXONOMY_PARENT: 'Choose an existing parent category.',
              TAXONOMY_GRAPH:
                'Keep categories under active parents, without loops, within twelve levels.',
              TAXONOMY_IN_USE:
                'Move active products and child categories before retiring this category.',
              TAXONOMY_URL_REQUIRED:
                'A category URL name cannot be cleared after it has been assigned.',
              TAXONOMY_SLUG_EXISTS: 'This URL name is reserved for another category.',
              TAXONOMY_STALE: 'This category changed. Reopen it before saving.',
              TAXONOMY_IDEMPOTENCY:
                'This save attempt belongs to different category details. Reopen and review.',
              CATEGORY_NOT_FOUND: 'The category could not be found.',
              MERCH_STALE:
                'Another version was saved. Reopen this guide or collection before saving.',
              MERCH_IDEMPOTENCY:
                'This save attempt belongs to different details. Reopen the record and review the changes.',
              MERCH_NOT_FOUND: 'The guide or collection could not be found.',
              SALES_RESERVED:
                'Release the active stock hold before editing or cancelling this draft.',
              STOCK_RESERVED:
                'This stock is reserved for sales orders. Release the relevant hold or use a smaller available quantity.',
              RESERVATION_PERMISSION:
                'Stock hold access requires inventory read and stock hold permission at this location.',
              RESERVATION_STALE:
                'The order or its stock holds changed. Refresh stock and review again.',
              RESERVATION_IDEMPOTENCY:
                'This request key belongs to different stock hold details. Close and reopen this form.',
              RESERVATION_NOT_FOUND: 'This order or stock hold could not be found.',
              RESERVATION_EXISTS: 'This order already has an active stock hold. Refresh stock.',
              RESERVATION_CLOSED: 'This stock hold has already been released. Refresh stock.',
              RESERVATION_UNAVAILABLE:
                'Choose an active customer, location and sellable variants before holding stock.',
              RESERVATION_INSUFFICIENT:
                'Available stock cannot cover the full order. Refresh stock, adjust the draft or receive stock first.',
              RESERVATION_BUSY: 'Stock is changing. Retry the unchanged request in a moment.',
              SALES_STALE: 'This order changed. Close this form and refresh before editing again.',
              SALES_STATE: 'Only draft orders can be edited or cancelled.',
              SALES_IDEMPOTENCY:
                'This request key belongs to different details. Close and reopen the form.',
              SALES_CUSTOMER_UNAVAILABLE: 'Choose an active customer.',
              SALES_CUSTOMER_STALE:
                'This customer changed. Reselect the customer and review the order.',
              SALES_CUSTOMER_SEGMENT:
                'The customer is not enabled for this sales channel. Choose the matching channel or update the customer profile.',
              SALES_LOCATION_UNAVAILABLE: 'Choose an active fulfillment location.',
              SALES_VARIANT_UNAVAILABLE:
                'A product is inactive or unavailable. Remove it or choose another active variant.',
              SALES_PRICE_CHANGED:
                'Catalog prices changed. Refresh catalog prices and review the draft again.',
              SALES_PRICE_PERMISSION:
                'A separate price override permission is required. Use current catalog prices or ask your workspace owner.',
              SALES_TOTAL_LIMIT: 'This order total exceeds the supported limit.',
              SALES_NOT_FOUND: 'This sales order could not be found.',
              CUSTOMER_STALE:
                'This customer changed. Close this form and refresh before editing again.',
              ENROLLMENT_REAUTH_REQUIRED:
                'Your owner password was not accepted. Re-enter it to confirm this action.',
              ENROLLMENT_PERMISSION: 'Your owner access or session changed. Sign in again.',
              ENROLLMENT_USERNAME_EXISTS: 'This username or account identifier is already in use.',
              ENROLLMENT_STALE: 'The activation record changed. Reopen it before continuing.',
              ENROLLMENT_IDEMPOTENCY:
                'This retry key belongs to another action. Reopen the record.',
              ENROLLMENT_STATE:
                'Only accounts that have not activated can receive or revoke an activation code.',
              ENROLLMENT_DISABLED:
                'This account is disabled. Review and reactivate it before issuing a new code.',
              ENROLLMENT_INVALID: 'Check the username, name, revision and required reason.',
              ENROLLMENT_ACTIVATION_INVALID:
                'The activation details are invalid or expired. Ask your owner for a new code, or sign in if you already activated.',
              ACTIVATION_PASSWORD_POLICY: 'Choose a password containing 15 to 128 characters.',
              ACCESS_OWNER_ONLY: 'Only an active owner can manage staff access.',
              ACCESS_PERMISSION:
                'Your access to this action changed. Sign in again or contact the owner.',
              ACCESS_PROTECTED:
                'Owner access and reserved administrative roles are protected in this screen.',
              ACCESS_STALE: 'This record changed. Reopen it before saving.',
              ACCESS_IDEMPOTENCY: 'This retry key belongs to another change. Reopen the record.',
              ACCESS_SCOPE:
                'Choose an active location and a role containing only location-compatible permissions.',
              ACCESS_ROLE_IN_USE: 'Remove this role from all staff assignments before retiring it.',
              ACCESS_INVALID: 'Check the names, selected permissions, assignments and reason.',
              ACCESS_CODE_EXISTS: 'This role code is already in use.',
              PUBLICATION_STALE:
                'This product or decision changed. Reopen the publication panel before continuing.',
              PUBLICATION_IDEMPOTENCY:
                'This retry key belongs to another decision. Reopen the panel.',
              PUBLICATION_INCOMPLETE:
                'Complete content, category and photo approval before publishing.',
              PUBLICATION_STATE:
                'This action is unavailable in the current state. Reopen the panel.',
              PUBLICATION_MEDIA_UNAVAILABLE:
                'A display photo is missing or changed. Restore and verify it before publishing.',
              PUBLICATION_INVALID: 'Check the reason, alternative text and current revisions.',
              GALLERY_STALE:
                'Product media or gallery order changed. Keep a note of your edits, then reopen the gallery to use current information.',
              GALLERY_MEDIA_CHANGED:
                'A selected photo or video is no longer available for this product.',
              GALLERY_IDEMPOTENCY:
                'This save request was already used for a different gallery change.',
              GALLERY_INVALID: 'Check the gallery order, current revision and reason.',
              GALLERY_NOT_FOUND: 'This product is unavailable or archived.',
              VIDEO_STALE: 'This video changed. Reload its current details before continuing.',
              VIDEO_INVALID:
                'Check the video details, reason, rights confirmation and supported format.',
              VIDEO_STATE: 'This action is no longer available for the current video status.',
              VIDEO_IDEMPOTENCY:
                'This request key belongs to different video details. Reload before retrying.',
              VIDEO_LIMIT: 'The configured product or pending-processing limit has been reached.',
              VIDEO_FILES_UNAVAILABLE:
                'Prepared video files are missing or changed. Ask the owner to verify storage.',
              VIDEO_INTAKE_DISABLED: 'Video uploads are not enabled in this environment.',
              VIDEO_BUSY: 'Video processing or delivery is busy. Try again shortly.',
              VIDEO_TOO_LARGE: 'This video exceeds the configured upload size.',
              VIDEO_UPLOAD_INCOMPLETE:
                'The video upload did not complete. Check the connection and retry.',
              VIDEO_UPLOAD_TIMEOUT: 'The video upload timed out. Check the connection and retry.',
              CONTENT_STALE: 'This product or content changed. Reload before continuing.',
              CONTENT_CHANGED:
                'The catalog or photos changed after submission. Request changes and submit a fresh version.',
              CONTENT_INCOMPLETE: 'Complete the review checklist before submitting or approving.',
              CONTENT_STATE: 'This review state no longer permits that action. Reload the content.',
              CONTENT_SELF_REVIEW:
                'A different reviewer must approve this content. Only an owner may explicitly self-approve.',
              CONTENT_SLUG_EXISTS: 'This product URL name is already in use.',
              CONTENT_IDEMPOTENCY:
                'This request key belongs to another action. Reload before retrying.',
              INVALID_CONTENT_INPUT:
                'Check the selected product type, values, URL name and field limits.',
              CONTENT_NOT_FOUND: 'This product could not be found.',
              CUSTOMER_RETAIL_ONLY:
                'Historical trade profiles are read-only. Only retail profiles can be changed.',
              SALES_RETAIL_ONLY: 'Only retail drafts at catalog prices can be changed.',
              RESERVATION_RETAIL_ONLY:
                'New stock holds are available only for retail drafts at catalog prices.',
              CUSTOMER_IDEMPOTENCY:
                'This request key was already used for different details. Close and reopen the form.',
              CUSTOMER_NOT_FOUND: 'This customer could not be found.',
              REPORT_EXPORT_TOO_LARGE:
                'This period has more than 5,000 entries. Choose a shorter period to download a CSV.',
              REPORT_RECONCILIATION:
                'The report could not reconcile its source records. Please contact the workspace owner.',
              PAYMENT_STALE:
                'Supplier payments changed. Close this form and refresh before continuing.',
              PAYMENT_REVERSED: 'This payment has already been reversed. Refresh payment history.',
              PAYMENT_INVOICE_UNAVAILABLE:
                'An invoice is unavailable, reversed or belongs to another supplier. Refresh the invoices.',
              PAYMENT_EXCEEDS_DUE:
                'An allocated amount exceeds the invoice balance. Refresh and check the remaining amounts.',
              PAYMENT_REFERENCE_EXISTS:
                'This payment or voucher reference already belongs to an active recorded payment.',
              PAYMENT_NOT_FOUND: 'This supplier or payment could not be found.',
              INVOICE_HAS_PAYMENTS:
                'Reverse the payments allocated to this invoice before reversing the invoice.',
              RECEIPT_INVOICED:
                'Reverse the active supplier invoices linked to this receipt before reversing its stock.',
              INVOICE_STALE:
                'Invoice allocations changed. Close this form and refresh invoices before continuing.',
              INVOICE_REVERSED: 'This invoice has already been reversed. Refresh invoices.',
              INVOICE_ORDER_STATE:
                'This order is no longer available for invoicing. Refresh the order.',
              INVOICE_RECEIPT_UNAVAILABLE:
                'A selected receipt is unavailable or reversed. Refresh invoices.',
              INVOICE_OVER_QUANTITY:
                'This quantity exceeds the received, uninvoiced quantity. Refresh invoices.',
              INVOICE_NUMBER_EXISTS:
                'This supplier invoice number already belongs to an active invoice for this supplier.',
              INVOICE_NOT_FOUND: 'This invoice or order could not be found.',
              STALE_RECEIPT:
                'Receiving changed since this form was opened. Refresh receiving before continuing.',
              RECEIPT_OVER_QUANTITY:
                'This receipt exceeds the remaining ordered quantity. Refresh receiving and check the counts.',
              RECEIPT_REFERENCE_EXISTS:
                'This delivery reference already belongs to an active receipt for this order.',
              RECEIPT_ALREADY_REVERSED: 'This purchase receipt has already been reversed.',
              PURCHASE_RECEIPTS_EXIST:
                'Reverse all active purchase receipts before cancelling this order.',
              PURCHASE_RECEIPT_MANAGED:
                'Correct this stock movement from its purchase order receipt in Purchasing.',
              RECEIPT_RECORD_NOT_FOUND:
                'This receipt, order or stock item is no longer available. Refresh the order.',
              STALE_PURCHASING_RECORD:
                'Someone saved a newer revision. Close and reopen the latest record.',
              SUPPLIER_CODE_IMMUTABLE: 'Supplier codes cannot be changed after creation.',
              PURCHASING_CODE_EXISTS:
                'This supplier code or document identifier is already in use.',
              PURCHASE_ORDER_STATE:
                'This action is unavailable for the current order status. Reload the order.',
              SUPPLIER_NOT_FOUND: 'This supplier is no longer available. Refresh the directory.',
              PURCHASE_ORDER_NOT_FOUND: 'This purchase order could not be found.',
              INSUFFICIENT_STOCK:
                'Not enough stock. Refresh inventory and check the physical quantity.',
              POSTING_ALREADY_REVERSED:
                'This posting has already been reversed. Refresh movement history.',
              CANNOT_REVERSE_REVERSAL:
                'A reversal cannot be reversed. Use a new stock action with a clear reason.',
              OPENING_STOCK_EXISTS:
                'This SKU already has movement history at this location. Use a receipt or adjustment.',
              INACTIVE_STOCK_VARIANT:
                'New stock cannot be received against an inactive or archived variant.',
              STOCK_QUANTITY_LIMIT: 'This quantity exceeds the supported stock balance.',
              LOCATION_CODE_EXISTS:
                'This location code already exists. Refresh locations or choose another code.',
              INVALID_PRODUCT_IMAGE:
                'Choose a valid, non-animated JPEG, PNG or WebP image within the displayed upload limits.',
              PHOTO_LIMIT:
                'This product reached its photo limit. Remove one before uploading another.',
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
    options?: {
      method?: 'POST' | 'PATCH';
      key?: string;
      image?: File;
      version?: number;
    } & ReadOptions,
  ): Promise<T> {
    const writing = body !== undefined;
    let response: Response;
    try {
      response = await fetch('/api/v1' + path, {
        method: writing ? (options?.method ?? 'POST') : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        ...(options?.signal ? { signal: options.signal } : {}),
        headers: writing
          ? {
              'Content-Type': options?.image?.type ?? 'application/json',
              ...(options?.image ? { 'X-Product-Version': String(options.version) } : {}),
              'X-Requested-With': 'commerce-staff',
              'X-CSRF-Token': this.csrf,
              ...(options?.key ? { 'X-Idempotency-Key': options.key } : {}),
            }
          : {
              Accept: 'application/json',
              ...(options?.background ? { 'X-Background-Read': '1' } : {}),
            },
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
  enrollments(search: string, page: number, read?: ReadOptions) {
    return this.request<EnrollmentPage>(
      '/staff-onboarding?' + new URLSearchParams({ search, page: String(page) }),
      undefined,
      read,
    );
  }
  enrollment(id: string, page = 1) {
    return this.request<EnrollmentView>('/staff-onboarding/' + id + '?page=' + page);
  }
  saveEnrollment(input: EnrollmentInput, ownerPassword: string, key: string) {
    return this.request<EnrollmentResult>(
      '/staff-onboarding',
      { ...input, ownerPassword },
      { key },
    );
  }
  activateEmployee(username: string, code: string, newPassword: string) {
    return this.request<{ activated: boolean; loginRequired: boolean }>('/auth/activate', {
      username,
      code,
      newPassword,
    });
  }
  accessPolicy() {
    return this.request<{ code: string; locationScope: boolean }[]>('/access/policy');
  }
  accessList(kind: string, search: string, page: number, read?: ReadOptions) {
    return this.request<AccessPage>(
      '/access/' + kind + '?' + new URLSearchParams({ search, page: String(page) }),
      undefined,
      read,
    );
  }
  accessRead(kind: string, id: string, page = 1) {
    return this.request<AccessView>('/access/' + kind + '/' + id + '?page=' + page);
  }
  accessChoices(kind: string, search: string, page: number) {
    return this.request<{ items: AccessChoice[]; total: number; page: number }>(
      '/access/choices/' + kind + '?' + new URLSearchParams({ search, page: String(page) }),
    );
  }
  saveAccess(input: AccessInput, key: string) {
    return this.request<{ id: string; version: number; revokedSessions: number }>(
      '/access',
      input,
      { key },
    );
  }
  team(read?: ReadOptions) {
    return this.request<TeamMember[]>('/staff', undefined, read);
  }
  categories(read?: ReadOptions) {
    return this.request<Category[]>('/catalog/categories', undefined, read);
  }
  createCategory(name: string, parentId: string | null) {
    return this.request<Category>('/catalog/categories', { name, parentId });
  }
  products(
    query: { search: string; status: string; categoryId: string; page: number },
    read?: ReadOptions,
  ) {
    const params = new URLSearchParams({
      search: query.search,
      status: query.status,
      page: String(query.page),
      pageSize: '20',
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    });
    return this.request<ProductPage>('/catalog/products?' + params, undefined, read);
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
  productVideos(id: string, page = 1, removed = false, read?: ReadOptions) {
    return this.request<VideoPage>(
      '/catalog/products/' + id + '/videos?page=' + page + (removed ? '&removed=1' : ''),
      undefined,
      read,
    );
  }
  videoHistory(id: string, page = 1) {
    return this.request<VideoHistory>('/catalog/videos/' + id + '/history?page=' + page);
  }
  videoAction(id: string, body: Record<string, unknown>, key: string) {
    return this.request<VideoResult>(
      '/catalog/videos/' +
        id +
        (['approve', 'revoke'].includes(String(body.action)) ? '/review' : ''),
      body,
      { key },
    );
  }
  uploadVideo(
    id: string,
    version: number,
    file: File,
    key: string,
    onProgress: (n: number) => void,
    signal: AbortSignal,
  ) {
    return new Promise<VideoResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/catalog/products/' + id + '/videos');
      xhr.withCredentials = true;
      const type = file.type || (/\.mov$/i.test(file.name) ? 'video/quicktime' : 'video/mp4');
      for (const [k, v] of Object.entries({
        'Content-Type': type,
        'X-Product-Version': String(version),
        'X-Idempotency-Key': key,
        'X-Requested-With': 'commerce-staff',
        'X-CSRF-Token': this.csrf,
      }))
        xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };
      const abort = () => xhr.abort(),
        cleanup = () => signal.removeEventListener('abort', abort);
      xhr.onload = () => {
        cleanup();
        let value: unknown;
        try {
          value = JSON.parse(xhr.responseText);
        } catch {
          value = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(value as VideoResult);
          return;
        }
        const code =
          value && typeof value === 'object' && 'code' in value && typeof value.code === 'string'
            ? value.code
            : undefined;
        if (xhr.status === 401 && this.authenticated) {
          this.forget();
          this.onSessionExpired?.();
        }
        if (code === 'PASSWORD_CHANGE_REQUIRED') this.onPasswordChangeRequired?.();
        reject(new ApiError(xhr.status, code));
      };
      xhr.onerror = () => {
        cleanup();
        reject(new Error('Video upload connection failed. Retry keeps the same request key.'));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new Error('Upload cancelled. Check the list before retrying.'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        cleanup();
        reject(new Error('Upload cancelled.'));
        return;
      }
      xhr.send(file);
    });
  }
  mediaPolicy() {
    return this.request<MediaPolicy>('/catalog/media-policy');
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
  inventoryLocations(read?: ReadOptions) {
    return this.request<InventoryLocation[]>('/inventory/locations', undefined, read);
  }
  createInventoryLocation(body: { code: string; name: string; kind: 'warehouse' | 'store' }) {
    return this.request<InventoryLocation>('/inventory/locations', body);
  }
  inventoryVariants(id: string, search: string) {
    return this.request<StockRow[]>(
      '/inventory/locations/' +
        encodeURIComponent(id) +
        '/variants?' +
        new URLSearchParams({ search }),
    );
  }
  stock(id: string, query: { search: string; stock: string; page: number }, read?: ReadOptions) {
    return this.request<StockPage>(
      '/inventory/locations/' +
        encodeURIComponent(id) +
        '/stock?' +
        new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  stockHistory(id: string, query: { search: string; page: number }, read?: ReadOptions) {
    return this.request<{ items: HistoryRow[]; total: number; page: number; pageSize: number }>(
      '/inventory/locations/' +
        encodeURIComponent(id) +
        '/history?' +
        new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  postStock(body: StockInput, key: string) {
    return this.request<StockPosting>('/inventory/postings', body, { key });
  }
  stockReversalPreview(id: string) {
    return this.request<ReversalPreview[]>(
      '/inventory/postings/' + encodeURIComponent(id) + '/reversal-preview',
    );
  }
  reverseStock(id: string, body: { reason: string; reference: string }, key: string) {
    return this.request<StockPosting>(
      '/inventory/postings/' + encodeURIComponent(id) + '/reverse',
      body,
      { key },
    );
  }
  suppliers(query: { search: string; status: string; page: number }, read?: ReadOptions) {
    return this.request<Page<Supplier>>(
      '/purchasing/suppliers?' + new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  supplier(id: string) {
    return this.request<Supplier>('/purchasing/suppliers/' + encodeURIComponent(id));
  }
  saveSupplier(id: string | null, body: SupplierInput, key: string) {
    return this.request<Supplier>(
      '/purchasing/suppliers' + (id ? '/' + encodeURIComponent(id) : ''),
      body,
      { method: id ? 'PATCH' : 'POST', key },
    );
  }
  purchaseLocations(read?: ReadOptions) {
    return this.request<PurchaseLocation[]>('/purchasing/locations', undefined, read);
  }
  purchaseVariants(search: string) {
    return this.request<PurchaseVariant[]>(
      '/purchasing/variants?' + new URLSearchParams({ search }),
    );
  }
  purchaseOrders(query: { search: string; status: string; page: number }, read?: ReadOptions) {
    return this.request<Page<PurchaseOrder>>(
      '/purchasing/orders?' + new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  purchaseOrder(id: string) {
    return this.request<PurchaseOrder>('/purchasing/orders/' + encodeURIComponent(id));
  }
  savePurchaseOrder(id: string | null, body: OrderInput, key: string) {
    return this.request<PurchaseOrder>(
      '/purchasing/orders' + (id ? '/' + encodeURIComponent(id) : ''),
      body,
      { method: id ? 'PATCH' : 'POST', key },
    );
  }
  purchaseOrderAction(
    id: string,
    action: 'issue' | 'cancel',
    body: { expectedVersion: number; reason?: string },
    key: string,
  ) {
    return this.request<PurchaseOrder>(
      '/purchasing/orders/' + encodeURIComponent(id) + '/' + action,
      body,
      { key },
    );
  }
  purchaseReceiving(id: string, page = 1) {
    return this.request<ReceivingPage>(
      '/purchasing/orders/' +
        encodeURIComponent(id) +
        '/receiving?' +
        new URLSearchParams({ page: String(page) }),
    );
  }
  receivePurchaseOrder(
    id: string,
    body: {
      expectedRevision: number;
      reason: string;
      reference: string;
      lines: { orderLineId: string; quantity: string }[];
    },
    key: string,
  ) {
    return this.request<ReceiptResult>(
      '/purchasing/orders/' + encodeURIComponent(id) + '/receipts',
      body,
      { key },
    );
  }
  reversePurchaseReceipt(
    id: string,
    body: { expectedRevision: number; reason: string; reference: string },
    key: string,
  ) {
    return this.request<ReceiptResult>(
      '/purchasing/receipts/' + encodeURIComponent(id) + '/reverse',
      body,
      { key },
    );
  }
  orderInvoices(id: string, page = 1, linePage = 1) {
    return this.request<InvoicePage>(
      '/payables/orders/' +
        encodeURIComponent(id) +
        '?' +
        new URLSearchParams({ page: String(page), linePage: String(linePage) }),
    );
  }
  supplierInvoices(query: { page: number; search: string; status: string }, read?: ReadOptions) {
    return this.request<InvoiceList>(
      '/payables/invoices?' + new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  postSupplierInvoice(
    id: string,
    body: {
      expectedRevision: number;
      number: string;
      invoiceOn: string;
      dueOn: string;
      tax: string;
      delivery: string;
      discount: string;
      reason: string;
      lines: { receiptId: string; orderLineId: string; quantity: string; unitCost: string }[];
    },
    key: string,
  ) {
    return this.request<InvoiceResult>(
      '/payables/orders/' + encodeURIComponent(id) + '/invoices',
      body,
      { key },
    );
  }
  reverseSupplierInvoice(
    id: string,
    body: { expectedRevision: number; reason: string },
    key: string,
  ) {
    return this.request<InvoiceResult>(
      '/payables/invoices/' + encodeURIComponent(id) + '/reverse',
      body,
      { key },
    );
  }
  paymentSuppliers(search: string) {
    return this.request<PaymentSupplier[]>(
      '/payables/payment-suppliers?' + new URLSearchParams({ search }),
    );
  }
  supplierPaymentPage(id: string, page = 1, invoicePage = 1) {
    return this.request<SupplierPaymentPage>(
      '/payables/suppliers/' +
        encodeURIComponent(id) +
        '/payments?' +
        new URLSearchParams({ page: String(page), invoicePage: String(invoicePage) }),
    );
  }
  supplierPayments(query: { page: number; search: string; status: string }, read?: ReadOptions) {
    return this.request<PaymentList>(
      '/payables/payments?' + new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  recordSupplierPayment(
    id: string,
    body: {
      expectedRevision: number;
      paidOn: string;
      method: 'cash' | 'bank' | 'mobile';
      source: string;
      reference: string;
      amount: string;
      reason: string;
      allocations: { invoiceId: string; amount: string }[];
    },
    key: string,
  ) {
    return this.request<PaymentResult>(
      '/payables/suppliers/' + encodeURIComponent(id) + '/payments',
      body,
      { key },
    );
  }
  reverseSupplierPayment(
    id: string,
    body: { expectedRevision: number; reason: string },
    key: string,
  ) {
    return this.request<PaymentResult>(
      '/payables/payments/' + encodeURIComponent(id) + '/reverse',
      body,
      { key },
    );
  }
  payableAging(query: { asOf?: string; search: string; page: number }, read?: ReadOptions) {
    return this.request<AgingReport>(
      '/payables/reports/aging?' + new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  supplierStatement(
    id: string,
    query: { from?: string; to?: string; page: number; invoicePage: number },
  ) {
    return this.request<SupplierStatement>(
      '/payables/suppliers/' +
        encodeURIComponent(id) +
        '/statement?' +
        new URLSearchParams({
          ...query,
          page: String(query.page),
          invoicePage: String(query.invoicePage),
        }),
    );
  }
  async supplierStatementCsv(id: string, query: { from: string; to: string }): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(
        '/api/v1/payables/suppliers/' +
          encodeURIComponent(id) +
          '/statement.csv?' +
          new URLSearchParams(query),
        { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/csv' } },
      );
    } catch {
      throw new Error('Unable to reach your workspace. Please try again.');
    }
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const code =
        data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
          ? data.code
          : undefined;
      if (response.status === 401 && this.authenticated) {
        this.forget();
        this.onSessionExpired?.();
      }
      if (code === 'PASSWORD_CHANGE_REQUIRED') this.onPasswordChangeRequired?.();
      throw new ApiError(response.status, code);
    }
    if (!response.headers.get('content-type')?.startsWith('text/csv'))
      throw new Error('The workspace returned an unexpected export.');
    return response.blob();
  }
  gallery(id: string, page = 1, read?: ReadOptions) {
    return this.request<GalleryView>(
      '/catalog/products/' + encodeURIComponent(id) + '/gallery?page=' + page,
      undefined,
      read,
    );
  }
  saveGallery(id: string, input: GalleryInput, key: string) {
    return this.request<{ version: number }>(
      '/catalog/products/' + encodeURIComponent(id) + '/gallery',
      input,
      { key },
    );
  }
  publication(id: string, page = 1, read?: ReadOptions) {
    return this.request<PublicationView>(
      '/catalog/products/' + encodeURIComponent(id) + '/publication?page=' + page,
      undefined,
      read,
    );
  }
  savePublication(id: string, input: PublicationInput, key: string, photoId?: string) {
    return this.request<{ version: number }>(
      '/catalog/products/' +
        encodeURIComponent(id) +
        '/publication' +
        (photoId ? '/photos/' + encodeURIComponent(photoId) : ''),
      input,
      { key },
    );
  }
  productContent(id: string, page = 1) {
    return this.request<ContentView>(
      '/catalog/products/' + encodeURIComponent(id) + '/content?page=' + page,
    );
  }
  saveProductContent(id: string, input: ContentInput, key: string) {
    return this.request<ContentResult>(
      '/catalog/products/' + encodeURIComponent(id) + '/content',
      input,
      { key },
    );
  }
  customers(
    query: { search: string; page: number; status: string; kind: string },
    read?: ReadOptions,
  ) {
    return this.request<CustomerPage>(
      '/customers?' + new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  customer(id: string) {
    return this.request<Customer>('/customers/' + encodeURIComponent(id));
  }
  customerMatches(phone: string, email: string, excludeId?: string) {
    return this.request<{ items: { id: string; code: string; name: string }[] }>(
      '/customers/contact-matches?' +
        new URLSearchParams({ phone, email, ...(excludeId ? { excludeId } : {}) }),
    );
  }
  saveCustomer(id: string | null, body: CustomerInput, key: string) {
    return this.request<CustomerResult>(
      '/customers' + (id ? '/' + encodeURIComponent(id) : ''),
      body,
      { key, ...(id ? { method: 'PATCH' } : {}) },
    );
  }
  customerCreditHistory(id: string, page: number) {
    return this.request<CreditHistory>(
      '/customers/' + encodeURIComponent(id) + '/credit-history?page=' + page,
    );
  }
  salesCustomers(search: string) {
    return this.request<SalesCustomer[]>('/sales/customers?' + new URLSearchParams({ search }));
  }
  salesLocations(read?: ReadOptions) {
    return this.request<SalesLocation[]>('/sales/locations', undefined, read);
  }
  salesVariants(search: string) {
    return this.request<SalesVariant[]>('/sales/variants?' + new URLSearchParams({ search }));
  }
  salesVariant(id: string) {
    return this.request<SalesVariant>('/sales/variants/' + encodeURIComponent(id));
  }
  salesOrders(query: { search: string; status: string; page: number }, read?: ReadOptions) {
    return this.request<SalesPage>(
      '/sales/orders?' + new URLSearchParams({ ...query, page: String(query.page) }),
      undefined,
      read,
    );
  }
  salesOrder(id: string) {
    return this.request<SalesOrder>('/sales/orders/' + encodeURIComponent(id));
  }
  saveSalesOrder(id: string | null, body: SalesInput, key: string) {
    return this.request<SalesResult>(
      '/sales/orders' + (id ? '/' + encodeURIComponent(id) : ''),
      body,
      { key, method: id ? 'PATCH' : 'POST' },
    );
  }
  cancelSalesOrder(id: string, body: { expectedVersion: number; reason: string }, key: string) {
    return this.request<SalesResult>('/sales/orders/' + encodeURIComponent(id) + '/cancel', body, {
      key,
    });
  }
  salesReservations(id: string, page = 1) {
    return this.request<ReservationPage>(
      '/sales/orders/' + encodeURIComponent(id) + '/reservations?page=' + page,
    );
  }
  postSalesReservation(id: string, kind: 'hold' | 'release', body: ReservationInput, key: string) {
    return this.request<ReservationResult>(
      '/sales/orders/' +
        encodeURIComponent(id) +
        '/reservations' +
        (kind === 'release' ? '/release' : ''),
      body,
      { key },
    );
  }
  merchItems(
    query: { search?: string; kind?: string; status?: string; page?: number },
    read?: ReadOptions,
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    return this.request<MerchPage>('/catalog/merchandising?' + params, undefined, read);
  }
  merchItem(id: string, page = 1) {
    return this.request<{
      item: MerchItem;
      history: {
        version: number;
        definition: MerchDefinition;
        reason: string;
        createdAt: string;
      }[];
      total: number;
      page: number;
      pageSize: number;
    }>('/catalog/merchandising/' + encodeURIComponent(id) + '?page=' + page);
  }
  saveMerch(body: MerchInput, key: string) {
    return this.request<{ id: string; version: number }>('/catalog/merchandising', body, { key });
  }
  taxonomy(query: { search?: string; status?: string; page?: number }, read?: ReadOptions) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
    return this.request<TaxonomyPage>('/catalog/taxonomy?' + params, undefined, read);
  }
  taxonomyItem(id: string, page = 1) {
    return this.request<{
      item: TaxonomyItem;
      history: {
        version: number;
        reason: string;
        snapshot: Omit<TaxonomyItem, 'path' | 'activeProducts'>;
        createdAt: string;
      }[];
      routes: string[];
      routeTotal: number;
      total: number;
      page: number;
      pageSize: number;
    }>('/catalog/taxonomy/' + encodeURIComponent(id) + '?page=' + page);
  }
  saveTaxonomy(body: TaxonomyInput, key: string) {
    return this.request<{ id: string; version: number }>('/catalog/taxonomy', body, { key });
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
