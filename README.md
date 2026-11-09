# Commerce Platform

Neutral ERP foundation and staff interface for a fashion/lifestyle ERP and future e-commerce.

Active workspace: D:\Business Software\commerce-platform. See [architecture and initial audit](ENGINEERING-PLAN.md), [engineering standards](docs/ENGINEERING-STANDARDS.md), [database decisions](docs/DATABASE-DECISION.md) and [staff identity API](docs/IDENTITY-API.md).

## Staff interface

Open http://127.0.0.1:4000/admin while start:local is running. Login, first-use password change, overview, product catalog/variants, multi-location inventory, suppliers/purchase orders/partial receiving/supplier invoices, searchable read-only team directory and profile/access screens are implemented. See [interface guide](docs/ADMIN-INTERFACE.md) and [visual direction / frontend decisions](docs/INTERFACE-DIRECTION.md).

## Current implementation

- Managed PostgreSQL connection, schema-aware readiness and shutdown cleanup.
- Staff login/logout, NFC-normalized password hashing, forced first-use password change and revocable database sessions.
- Default-deny route protection, action permissions and location scopes.
- CSRF synchronizer tokens, strict cookies, persistent login limits, bounded hashing work and input/error redaction.
- Transactional audit events with append-only runtime access.
- Compiled migrations, restricted runtime grants and a protected one-time owner bootstrap.

The staff workspace, catalog/variants and protected product-photo workflow are implemented. See [product photos and storage decisions](docs/PRODUCT-MEDIA.md). See [catalog workflow and decisions](docs/CATALOG.md). Sales, staff/role editing, MFA and recovery remain future slices. This is a verified local development increment, not a complete or production-ready ERP. [Multi-location inventory](docs/INVENTORY-DESIGN.md) now provides physical receipts, transfers, adjustments, movement history and reversals using the same access/audit foundation. [Suppliers and purchase orders](docs/PURCHASING.md) now support audited supplier records and versioned draft/issue/cancel orders. [Partial purchase receiving](docs/PURCHASE-RECEIPTS.md) now updates PO progress and physical stock atomically, with audited reversals. [Supplier invoice matching](docs/SUPPLIER-INVOICES.md) now supports partial invoice quantities, exact charges, recorded unsettled totals and controlled reversals. [Supplier payment records](docs/SUPPLIER-PAYMENTS.md) now support partial/consolidated invoice allocations, exact remaining balances and audited reversal. [Recorded supplier statements and aging](docs/PAYABLES-REPORTS.md) now add historical cutoffs, exact aging buckets and safe CSV export. [Customer records and credit policy](docs/CUSTOMERS.md) now support retail/wholesale profiles, normalized/shared contacts, independent billing/delivery addresses and separately permissioned configured BDT credit limits with reason/history. Sales/customer receivables, imported opening balances, credits and the accounting ledger remain future increments. Original image quality and configurable limits are described in [original media](docs/ORIGINAL-MEDIA.md); [storage and costs](docs/LOCAL-STORAGE-AND-COSTS.md) explains the current local setup.

## Storefront direction

The owner selected Aarong/Taaga for storefront layout, product presentation and feature coverage, with Tabaya-inspired product video alongside images. See the [source-backed feature matrix and architecture impact](docs/STOREFRONT-REFERENCE.md). The current storefront scope is Bangladesh only (BDT), with one brand across all departments: no country selector or sub-brand/brand switcher. Rich specifications/filters, collections/size guides, mixed media and publication rules must be supplied by the ERP. These are recorded requirements; the current app remains the staff workspace, with no public checkout or video upload yet.

## Local commands

Requires Node 24 LTS and npm. Exact dependencies are locked in package-lock.json.

```powershell
npm ci --ignore-scripts
npm run secrets:check
npm run format:check
npm run check
npm test
npm run test:database
npm run db:verify-local
npm run media:verify-local
npm run inventory:verify-local
npm run purchasing:verify-local
npm run invoices:verify-local
npm run payments:verify-local
npm run customers:verify-local
npm run build
npm run start:local
```

Local API: http://127.0.0.1:4000. Health endpoints: /api/v1/health/live and /api/v1/health/ready. Ready checks database connectivity and expected schema revision; startup fails if migrations/grants are missing. App startup never changes schema. Pool size is 10 with bounded connection/query timeouts.

.env and .env.test already contain generated connection credentials. Do not overwrite them with .env.example. Keep them, .env.setup and .local-setup outside source control. npm offline mode is enabled by the environment; dependency downloads require a per-command --offline=false override rather than changing global settings.

## Owner access

The development owner exists. Its username and one-time password are in .local-setup/owner-access.json, protected by explicit Windows ACLs for the current user and SYSTEM. Do not share that file or paste its contents in chat. The API enforces a password change before business access. The browser login screen is available at /admin.

The saved pgAdmin connection was used for initial database/role provisioning. Direct administrator password authentication remains unresolved and is not needed for routine application/test access. Do not rerun setup SQL, automatic provisioning or owner bootstrap against the completed setup.

## Verification — 8 November 2026

Strict type checking, clean build, formatting check, 28 database-free/interface tests and 139 reported PostgreSQL integration checks passed. The PostgreSQL checks include real HTTP login/logout, CSRF denial, scope denial, forced password change, session expiry/revocation/deactivation, login throttling, audit rollback/immutability, Secure cookie policy and migration apply/repeat/revert.

Development migration applied once. A separate owner smoke test verified login, forced-change restriction, logout/revocation, bootstrap refusal on repeat, unchanged credential artifact and no-op repeated migration. Private-file ACLs were inspected. Dependency installation audit reported zero known vulnerabilities.

The original Documents copy is an earlier snapshot blocked by Windows Controlled Folder Access. Continue only in this D: workspace.

Source publication excludes all private local credential/setup files. The GitHub CI workflow runs isolated PostgreSQL and interface/security checks; database backup/restore remains separate from code backup.
