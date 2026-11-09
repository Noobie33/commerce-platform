# Local staff interface

Open http://127.0.0.1:4000/admin while the local application is running. The root URL also serves the sign-in page.

## Available screens

- Sign-in using existing staff credentials.
- Forced first-use password change.
- Workspace overview with real session/access state and live readiness status.
- Read-only staff directory with local search and explicit 100-account limit.
- Profile, location/action access summary and password change.
- Working sign-out, session-expiry handling, loading, empty-result and failure states.
- Responsive desktop/compact navigation with keyboard focus, Escape/Tab handling and skip link.

The catalog screen supports real product/variant create, view, edit, search, category/status filters and pagination. See [catalog decisions](CATALOG.md). Inventory and purchasing are implemented; sales remains planned; no business totals or placeholder transactions are presented as real data. Staff/role editing and audit-history UI remain future slices.

## Reference-driven visual refresh

The catalog now has a white/light-gray and orange visual system, readable Segoe UI/system type, desktop top navigation, card/table views and an inline product details panel on wide screens. Compact screens use the same details in a modal dialog. Existing create/edit/category/search/pagination and staff screens are retained. See [interface direction and stack decisions](INTERFACE-DIRECTION.md). Product-photo upload, unchanged originals, protected original download, configurable live limits, preview, primary selection and gallery are implemented; products without photos retain a clear empty state. See [product-media guide](PRODUCT-MEDIA.md).

## Architecture and reasons

The maintained React 19.3.1/Vite 8.3.6 admin workspace lives under apps/admin. Exact versions were checked against existing Node 24.16.0 before installation. This is a private staff SPA; it does not need a second server runtime or SEO rendering. A future public storefront can choose its own rendering approach.

npm run build first compiles the Nest API, then builds the admin bundle into dist/public/admin. Nest serves only index.html and the generated assets, never the repository root or configuration files. UI and API share an origin, preserving the existing HttpOnly cookie and CSRF boundary without wildcard CORS.

The browser keeps the CSRF token in memory, never an authentication token in local/session storage. Staff data is loaded from the protected API. Responses are no-store. The index has a self-only content security policy and no external font/image/CDN dependencies.

## Start and verification

From D:\Business Software\commerce-platform:

```powershell
npm run build
npm run start:local
```

Open the URL above. Username for the bootstrapped development owner is owner; the one-time credential is in the ignored/private .local-setup/owner-access.json file. It is not bundled into the interface. First login requires password change. Do not paste credentials into chat or commit them.

Browser QA used only a disposable test-database account, leaving the real owner untouched. Sign-in, forced-change screen, overview, staff search/no-results, profile/access, compact navigation/focus and sign-out were observed. Desktop/compact page widths were checked and browser error/warning logs were empty. Actual password-change mutation is covered by PostgreSQL HTTP tests; the browser QA did not change the user's password.

Catalog browser QA also created a category and a product with six generated size/colour variants, verified exact decimal prices, duplicate-barcode feedback, edit/archive, search/no-results and compact modal/navigation behaviour. A browser validation issue and compact-page overflow were corrected and rechecked. The final compact layout had no horizontal page overflow; background scrolling is locked during modal use and hidden navigation is inert. Browser warning/error logs were empty on the final build.

Temporary QA server/account and catalog fixtures were removed after testing. The normal local application is left available for the user. Source changes require another build; this local setup does not silently auto-deploy to the internet.

## GitHub and backups

The Git repository contains source, lockfile, documentation and CI, not .env files, private setup SQL/credentials, node_modules or build output. secrets:check checks tracked files and committed history against credential patterns and current local secrets without printing them.

The CI workflow uses pinned official action revisions, Node 24 and a disposable PostgreSQL 18.6 service. It runs type/style checks, local tests and real database/security integration tests with ephemeral generated credentials. It never uses the development owner's credentials.

GitHub is a code history/backup destination. Database backups and restore testing are separate work; no database contents are published with the source.

## Stock and locations

The Inventory navigation supports active warehouses/stores, a per-location physical-stock summary, searchable/paginated SKU balances and movement history. Opening stock, receipts, transfers and signed adjustments use SKU search, a reason/reference and a review before posting. A separate reversal preview verifies permission at all affected locations before showing their names and quantities. Ordinary scoped history remains limited to its selected location.

The desktop table scrolls horizontally inside its panel on narrow screens; the surrounding page and entry dialogs fit a 390px viewport. Quantity displays use exact integer formatting. Browser QA verified disposable location creation, opening/receipt, decrease adjustment, balanced transfer, reversal, insufficient-stock warning and desktop/mobile layouts. No example stock or locations are inserted into the development business database. See [inventory decisions](INVENTORY-DESIGN.md).

## Suppliers and purchasing

The Purchasing navigation includes searchable supplier records and draft/issued/cancelled purchase orders. Supplier/contact edits preserve issued-order snapshots. Order preparation supports active supplier lookup, SKU search, delivery location/date, exact BDT unit costs and review before save/issue. Cancellation requires a reason and retains history. Saving/issuing/cancelling these documents does not change stock or create bills/payments. The order detail now includes ordered/received/remaining quantities, partial/full receipt status, review-before-receive and whole-receipt reversal with preserved history. Active receipts block cancellation. See [receiving decisions](PURCHASE-RECEIPTS.md). Browser QA verified creation/edit/issue/cancel, exact two-line totals, preserved supplier contacts after master edits, 1024px navigation, 390px forms and contained horizontal tables. See [purchasing decisions](PURCHASING.md).

## Supplier invoice matching

Purchasing now includes Supplier invoices. Open an issued order after receiving goods to record partial supplier invoice quantities, actual prices, invoice/due dates and explicit tax/delivery/discount amounts. Review before confirming; stock stays unchanged. Active recorded invoice totals exclude reversed invoices. Whole-invoice reversal preserves history and releases matching quantities; active invoices block receipt reversal. Recorded payments now reduce invoice balances; accounting journals remain a later workflow. See [invoice scope and integrity](SUPPLIER-INVOICES.md).

## Supplier payment records

Purchasing / Supplier payments supports supplier lookup, outstanding invoices, partial or consolidated payments across up to 25 invoices, exact allocation review and complete payment reversal history. Method/source/date/reference describe a payment already made; no money is sent. Invoice rows now show paid/remaining amounts and unpaid/partially paid/paid status, with corresponding filters and overdue search. Active payments block invoice reversal. Order invoice panels also open the supplier payment workspace. See [payment rules and limits](SUPPLIER-PAYMENTS.md).

## Recorded supplier reports

Purchasing / Statements & aging adds a Bangladesh-date cutoff, supplier search, full filtered aging totals and paginated supplier rows. Open a supplier statement for a date period, brought-forward/increase/reduction/closing amounts, historical outstanding invoices and recorded activity with actors/reasons. Supplier payments also opens the statement. CSV downloads all period events up to 5,000, preserves Bengali and protects spreadsheet cells against formulas. These read-only reports use recorded timestamps, not document dates, and do not import opening balances or create accounting journals. See [report basis and verification](PAYABLES-REPORTS.md).

## Customer directory

Customers supports retail/wholesale/both classification, people/business profiles, literal search, status/type filters and pagination. Contact details, independent Bangladesh billing/delivery addresses, explicit copy-address and active/inactive status live in one profile. Shared phone/email matches warn without blocking save. Credit managers separately review exact BDT limits/terms with a mandatory reason and inspect previous/current policy history; no artificial customer due/available-credit totals are shown. See [customer decisions](CUSTOMERS.md).

## Sales preparation

Sales adds a searchable/filterable order directory and retail/wholesale draft editor. Choose an active compatible customer, fulfillment location and active product variants. Catalog prices are the default; overriding requires permission and a reason. The editor calculates exact BDT goods totals and reviews before saving. Saved customer/address/product snapshots remain visible after directory changes. Only draft orders can be edited/cancelled, with version checks and cancellation reasons; cancellation preserves all lines. These drafts create no stock reservations or customer due amounts. See [sales boundaries and next gates](SALES-DRAFTS.md).
