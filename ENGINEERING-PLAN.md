# Commerce Platform: audit, architecture and roadmap

> This is the initial audit and phased plan. For current implementation and verified results, read README.md and docs/IDENTITY-API.md.

Audit: 8 November 2026, Asia/Dhaka. Neutral internal name: commerce-platform. Brand name/logo will be configuration. Current work is a foundation, not a production ERP.

## PC audit

| Tool              | Observed          | Decision                                                                                                                               |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Node              | 24.16.0           | Keep supported 24 LTS major; update its security patch before production after compatibility review.                                   |
| npm / pnpm        | 11.13.0 / 12.11.2 | Use existing npm and package-lock for new project; preserve faculty pnpm lock.                                                         |
| Git               | 2.51.2.windows.1  | Available; no remote/backup configured.                                                                                                |
| VS Code           | 1.112.0 x64       | Available.                                                                                                                             |
| PostgreSQL client | 18.6              | Supported. postgresql-x64-18 runs; pg_isready reports accepting connections on 5432. SQL login and actual server version not verified. |
| Docker / Yarn     | Not in PATH       | Not required now; PATH absence does not prove absence from PC.                                                                         |
| Python            | WindowsApps alias | Interpreter not verified; not required.                                                                                                |

Starting workspace was empty. Source .env was not read. No existing SQL data, schema, source or global software was changed.

## Faculty boilerplate assessment

Source: D:\Business Software\nest-boilerplate. Static review only; dependencies were not installed there and its build/tests were not run. No top-level Git history seen; maintenance history cannot be established.

Useful foundations: NestJS 11 modules, strict TypeScript, TypeORM/PostgreSQL scaffolding, synchronize:false, migration scripts, pnpm lock, Helmet/CORS and roles scaffolding.

| Finding                               | Evidence and consequence                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unverified tokens accepted by a guard | src/common/guard/auth.guard.ts comments out token verification and returns true for non-blacklisted tokens. No usage on inspected routes found; latent vulnerability, not proof of an exposed protected route. |
| Authentication incomplete             | JWT wrappers exist, no PassportStrategy implementation found.                                                                                                                                                  |
| Node versions conflict                | .nvmrc 18.17.0; Dockerfile node:20; README 22+. Node 18/20 now EOL.                                                                                                                                            |
| Production migration gap              | database.config.ts glob matches *.ts only, excluding compiled .js migrations.                                                                                                                                  |
| Migration failure handling incomplete | typeorm_migration_run.ts logs errors without explicit failure status/connection cleanup.                                                                                                                       |
| Validation not globally connected     | ValidationPipe exists but main.ts has no useGlobalPipes.                                                                                                                                                       |
| Insecure configuration defaults       | main.ts has literal cookie secret fallback and unrestricted trust proxy=true; needs deployment-specific boundaries.                                                                                            |
| Tooling mismatch                      | ESLint 9 with legacy .eslintrc.js; no flat config found. Runtime lint not tested.                                                                                                                              |
| No demonstrated tests                 | Test scripts exist, but no spec/test files or referenced test/jest-e2e.json found.                                                                                                                             |
| Unrelated coupling                    | KDex branding, private-key/blockchain/RTC configuration and Bull/Redis startup.                                                                                                                                |
| Naming bug                            | splittedClassName[splittedClassName.length] is out of bounds in database.config.ts.                                                                                                                            |

Adapting preserves familiar conventions but requires security, migration, runtime and tooling repairs plus removing unrelated services. No fashion workflows/entities are implemented to justify carrying that work forward. Decision: clean small official-style Nest foundation in the current workspace; faculty copy remains a reference. Reuse ideas only after review/tests; do not copy guards/secrets wholesale.

Nest 12.4.0 is a stable published version verified against official releases and npm metadata. Native ESM/TypeScript 6 match Nest 12 guidance and Node 24 satisfies runtime requirements. A fresh project avoids legacy migration costs. Pin exact dependencies and lock transitive versions. Do not assume indefinite Nest support: review upstream security/maintenance regularly. Selection is based on compatibility and maintenance, not newest-label alone.

## Architecture

Start with a modular monolith: one Nest API and PostgreSQL database. Stock, sales and finance need atomic transactions; microservices would add distributed failure and operational work before scale justifies them. Extract workers/services only when measured load or independent ownership requires it.

Initial API uses src/. Future layout can become apps/api, apps/admin, apps/storefront and packages/contracts when multiple apps justify workspace tooling. Staff UI and online store share backend business rules. Frontend versions will be selected after support checks when that phase starts.

| Module          | Responsibility                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/access | Staff accounts, sessions, permissions and location scope; protected routes deny by default.                                                  |
| Organization    | Business settings, locations, document numbering; one brand, no speculative SaaS tenancy.                                                    |
| Catalog         | Products/styles, size/color variants, unique SKUs, barcodes, attributes, categories and media. Kids/men/women/lifestyle are data categories. |
| Inventory       | Movement ledger, reservations, balances, counts, transfers and in-transit stock across locations.                                            |
| Purchasing      | Suppliers, purchase orders, partial goods receipts, supplier invoices, payments and returns.                                                 |
| Sales/customers | B2C/B2B quotes/orders, price lists, tiers, credit terms, fulfillment, returns and customer history.                                          |
| Finance         | Receivables/payables, payment allocations, balanced journals, aging and reversals.                                                           |
| Audit           | Actor/action/entity/reason/request ID plus redacted changes and restricted access.                                                           |
| Integrations    | Payment/courier/storage adapters, transactional outbox, deduplicated callbacks and notifications.                                            |

Use explicit PostgreSQL migrations and constraints; no production automatic schema synchronization. Prefer a maintained TypeORM release after checking Nest 12 peer compatibility in the DB increment: it matches the faculty ecosystem and permits explicit SQL/locking. The implemented foundation uses pinned TypeORM with explicit SQL migrations and no automatic schema synchronization.

Business invariants and reasons:

- Product represents a style; sellable combinations have unique SKUs. Extensible attributes and hierarchical categories accommodate future lifestyle products without separate systems. Archive referenced records.
- Every stock movement records variant/location/quantity/source/actor/time. Balances reconcile to movements. Available = on-hand minus reserved. Transfers have dispatch/in-transit/receipt; returns have disposition. Default blocks negative stock.
- Lock affected stock rows deterministically; use unique document references and idempotency keys. Two simultaneous purchases of the last unit must not both succeed.
- Purchase orders do not change stock. Receipt changes stock; supplier invoice creates liability; payment settles it. Support partial receipts/payments and returns.
- Money uses exact decimal or integer minor units plus currency, never floating point. Freeze posted price/discount/tax/address snapshots. UTC persistence; Asia/Dhaka display and configurable BDT default.
- Financial events create balanced journal postings. Dues derive from documents and payment allocations. Correct posted entries with reversals. Operational subledgers do not constitute statutory/tax compliance; validate those rules separately.
- Explicit draft/approval/post/reverse workflows and thresholds control refunds, discounts, credit and stock adjustments. Commit related stock/journal/audit writes atomically.
- Define reservation expiry before checkout. Verify callback signatures; deduplicate and reconcile callbacks. Commit outbox events with business transactions; retry external delivery separately.
- Enforce permissions and location scope on server. Hash passwords, revoke/rotate sessions, throttle login, validate payloads and redact logs. Cookie-authenticated writes need CSRF defense. Choose session mechanism with deployment topology.
- Media uses a storage adapter with upload validation/limits; secrets remain outside source control. Version REST under /api/v1, generate OpenAPI clients as business endpoints arrive and bound pagination/filtering.
- Start search in PostgreSQL. Defer Redis, queues, Docker and external search until an actual slice needs them.
- Production needs TLS, redacted structured logs/request IDs, metrics/alerts, DB readiness, isolated credentials, automated backups and demonstrated restore. Liveness must not claim database readiness.

## Phases and acceptance gates

Each phase produces a usable demonstration. Estimates follow the first complete vertical slice, not a promise to finish a full ERP in days.

| Phase | Deliverables                                                                 | Gate                                                                                                            |
| ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0     | Audit, architecture, config/liveness foundation                              | Build and real HTTP tests pass; limits recorded.                                                                |
| 1     | Isolated dev/test DBs, migrations, identity, scoped roles/audit, staff shell | Empty DB and compiled migrations pass; unauthorized/cross-location access denied; secrets redacted.             |
| 2     | Catalog/variant UI, locations, opening stock, transfers/counts               | Duplicate SKU blocked; two-location reconciliation and final-unit concurrency pass.                             |
| 3     | Suppliers, PO/partial receipt, invoice/payment/return                        | Exactly-once stock effects, retry safety and balances reconcile.                                                |
| 4     | B2C/B2B sales, customer history, collections/credit                          | Reserve/ship/return stock and journals reconcile; aging matches allocations; refund permissions pass.           |
| 5     | Operational pilot, reports/import/export/recovery                            | Purchase-to-return demo; backup restored; deployment/rollback rehearsed; staff walkthrough.                     |
| 6     | Storefront, checkout, payment/courier integrations                           | Sandbox callback/retry/refund tests; no overselling across channels.                                            |
| 7     | POS, then manufacturing                                                      | Till/shift reconciliation; offline conflict policy before offline POS; BOM/material/output/cost reconciliation. |

First business slice after phase 1: create T-shirt variants, receive stock, transfer stock, sell with partial payment, view stock/customer due, then return/reverse. Build staff screens and server behavior together per slice.

## Storefront requirement update

The owner has selected Aarong/Taaga as the main visual/functionality reference and Tabaya for product video with photos. [Reference audit and implementation contract](docs/STOREFRONT-REFERENCE.md) maps this to structured product specifications, facets, collections, size guides, mixed media, publication and connected customer/sales workflows. The current release is Bangladesh-only and single-brand: omit country/region and sub-brand switchers, while keeping department/category navigation and internal inventory locations. These requirements extend the storefront phases; current purchasing receipt work continues as the operational dependency. Account/checkout/rewards parity requires further acceptance work rather than assuming it from public navigation.

## Execution and limits

Small reviewable changes; preserve existing data/source; pin dependencies; review migrations; no seeds against existing business databases. Tests cover changed behavior through type/build, HTTP and isolated PostgreSQL integration. Inventory/finance require concurrency, rollback and duplicate-request tests. Vulnerability scans require triage and do not prove complete security.

Current local increments implement database readiness, staff identity and scoped permissions, catalog/variants, private original-image storage and multi-location quantity inventory with a React/Vite staff interface. See the README and module decision documents for verified behavior and remaining limits. The initial transfer workflow posts both locations together; dispatch/in-transit/receipt approval is a later workflow before shipment-based transfers are enabled. Supplier records and draft/issue/cancel purchase orders are now implemented; partial purchase receipts and controlled stock-linked reversals are now implemented. Supplier invoices and payment allocation are next. Production deployment, backup restore rehearsal, MFA, financial subledgers and the storefront remain outstanding.

Sources checked: [Node support](https://nodejs.org/en/about/previous-releases), [Nest releases](https://github.com/nestjs/nest/releases), [Nest migration](https://docs.nestjs.com/migration-guide), [PostgreSQL support](https://www.postgresql.org/support/versioning/), official npm metadata.
