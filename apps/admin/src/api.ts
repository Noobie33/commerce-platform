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
  supplierPayments(query: { page: number; search: string; status: string }) {
    return this.request<PaymentList>(
      '/payables/payments?' + new URLSearchParams({ ...query, page: String(query.page) }),
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
  payableAging(query: { asOf?: string; search: string; page: number }) {
    return this.request<AgingReport>(
      '/payables/reports/aging?' + new URLSearchParams({ ...query, page: String(query.page) }),
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
  customers(query: { search: string; page: number; status: string; kind: string }) {
    return this.request<CustomerPage>(
      '/customers?' + new URLSearchParams({ ...query, page: String(query.page) }),
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
  salesLocations() {
    return this.request<SalesLocation[]>('/sales/locations');
  }
  salesVariants(search: string) {
    return this.request<SalesVariant[]>('/sales/variants?' + new URLSearchParams({ search }));
  }
  salesVariant(id: string) {
    return this.request<SalesVariant>('/sales/variants/' + encodeURIComponent(id));
  }
  salesOrders(query: { search: string; status: string; page: number }) {
    return this.request<SalesPage>(
      '/sales/orders?' + new URLSearchParams({ ...query, page: String(query.page) }),
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
