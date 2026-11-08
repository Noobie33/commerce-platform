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
      (['INVALID_CATALOG_INPUT', 'INVALID_INVENTORY_INPUT', 'INVALID_PURCHASING_INPUT'].includes(
        code ?? '',
      ) &&
      validationMessage &&
      validationMessage.length < 240
        ? validationMessage
        : '') ||
        (code &&
          (
            {
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
  inventoryLocations() {
    return this.request<InventoryLocation[]>('/inventory/locations');
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
  stock(id: string, query: { search: string; stock: string; page: number }) {
    return this.request<StockPage>(
      '/inventory/locations/' +
        encodeURIComponent(id) +
        '/stock?' +
        new URLSearchParams({ ...query, page: String(query.page) }),
    );
  }
  stockHistory(id: string, query: { search: string; page: number }) {
    return this.request<{ items: HistoryRow[]; total: number; page: number; pageSize: number }>(
      '/inventory/locations/' +
        encodeURIComponent(id) +
        '/history?' +
        new URLSearchParams({ ...query, page: String(query.page) }),
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
  suppliers(query: { search: string; status: string; page: number }) {
    return this.request<Page<Supplier>>(
      '/purchasing/suppliers?' + new URLSearchParams({ ...query, page: String(query.page) }),
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
  purchaseLocations() {
    return this.request<PurchaseLocation[]>('/purchasing/locations');
  }
  purchaseVariants(search: string) {
    return this.request<PurchaseVariant[]>(
      '/purchasing/variants?' + new URLSearchParams({ search }),
    );
  }
  purchaseOrders(query: { search: string; status: string; page: number }) {
    return this.request<Page<PurchaseOrder>>(
      '/purchasing/orders?' + new URLSearchParams({ ...query, page: String(query.page) }),
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
  supplierInvoices(query: { page: number; search: string; status: string }) {
    return this.request<InvoiceList>(
      '/payables/invoices?' + new URLSearchParams({ ...query, page: String(query.page) }),
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
