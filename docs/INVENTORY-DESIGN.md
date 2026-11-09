# Multi-location inventory

Implemented as a quantity-only vertical slice: warehouse/store creation, stock overview, SKU search, opening stock, receipts, signed adjustments, transfers, immutable history and compensating reversals. The staff interface is available at `/admin#inventory`.

## Why this design

A ledger records every physical movement. A materialized balance makes normal stock reads fast. Both are committed in one PostgreSQL posting function, alongside the audit event and retry response. The restricted runtime role may read inventory but cannot directly insert, update or delete its ledger, postings, balances or retry records. This keeps the invariant at the database posting boundary, including when application code changes later.

The function is owned by the migration role, uses a fixed `pg_catalog` search path and schema-qualified application objects, and has no PUBLIC execute privilege. Only the reviewed wrapper is executable by the application role. Migration credentials are for setup/maintenance and must never be exposed through business endpoints. The function's actor argument is supplied by authenticated server code, never from request input; runtime database credentials remain a trusted service secret.

Every affected location requires `inventory.read` plus its write permission: `inventory.receive` for opening/receipt, `inventory.adjust` for adjustment or single-location reversal, and `inventory.transfer` at both ends of a transfer/reversal. Permissions and active staff/location state are checked again at the posting boundary, before returning even a cached retry. Scope-filtered stock/history reads include only the selected location's quantities. Location master creation requires global `locations.manage`.

Balance locks are acquired in deterministic location/SKU order, preventing concurrent overselling and avoiding reversed lock orders in multi-SKU transfers. Idempotency serializes the same request key and compares actor plus canonical payload hash. Clients retain the key for an unchanged retry after connection failure. Changed payloads need a new key. The HTTP layer canonicalizes SKU order and validates strict fields, UUIDs and whole-piece decimal strings.

Posted entries cannot be edited or deleted by the application. Corrections append an opposite posting, linked to the original. One original may be reversed once; reversing a reversal is refused. A transfer reversal reverses both locations together. If the location no longer has sufficient stock, it fails without changing either side. The UI requires a reason and shows a review before posting.

## Scope and limits

- Whole pieces per variant, 1–25 distinct SKUs per posting; signed non-zero adjustment lines.
- Maximum magnitude per line: 999,999,999 pieces; maximum resulting balance per location/SKU: 1,000,000,000,000. These explicit bounds protect arithmetic/input handling, rather than relying on floating point. Quantities travel as decimal strings.
- Opening stock is allowed only before any movement for that location/SKU, even when its balance later returns to zero.
- New receipts/opening stock require an active variant and a non-archived product. Draft products may hold prelaunch stock. Physical transfers/corrections of inactive variants remain possible so deactivated merchandise can be moved out or reconciled. In-flight master-data changes do not retroactively cancel already authorized operations.
- Inactive locations cannot receive or post movements. Location editing/deactivation and staff-role editing are future administration increments.
- Stock overview lists SKUs with a recorded movement, including retained zero balances; it does not manufacture a zero balance for every catalog variant. Location summary totals are independent of search filters.
- On hand means recorded physical stock. [Sales stock holds](SALES-RESERVATIONS.md) now provide separate reserved/available quantities and protect all deductions/reversals. Quarantine buckets and configurable low-stock thresholds remain later workflows.
- No purchase cost, landed cost, tax, valuation, COGS, supplier bill or accounting transaction is created by a stock receipt. Purchasing and financial policy will be implemented explicitly next.
- Fabric length/weight, unit conversion, kits and manufacturing consumption require a separate base-unit design.

## API

All business routes require a current staff session. Writes also require same-origin JSON, CSRF and `X-Requested-With: commerce-staff`.

- `GET /api/v1/inventory/locations`: active locations accessible to the account, with per-location action flags.
- `POST /api/v1/inventory/locations`: unique code, name, warehouse/store kind; atomic audit. An uncertain retry uses the same unique code, then refreshes the location list.
- `GET /api/v1/inventory/locations/:locationId/stock`: literal search, all/positive/zero filter, bounded pagination and complete-location summary.
- `GET /api/v1/inventory/locations/:locationId/variants`: bounded SKU/product search to prepare entries; supports the inventory role without requiring global catalog management.
- `GET /api/v1/inventory/locations/:locationId/history`: bounded pagination, literal search, optional variant filter; includes reversal state and per-location movement lines.
- `POST /api/v1/inventory/postings`: opening/receipt/adjustment/transfer; UUID `X-Idempotency-Key` required.
- `GET /api/v1/inventory/postings/:id/reversal-preview`: a separate preview checks read/write permission at **every** affected location before loading or exposing cross-location lines or names. Ordinary scoped history never returns the other location’s quantities.
- `POST /api/v1/inventory/postings/:id/reverse`: reason/reference plus a new idempotency key; the original posting determines lines and endpoints.

Read-only reconciliation: `npm run inventory:verify-local` checks materialized balances against ledger sums, missing movement lines and unbalanced transfers. It never repairs or deletes records. CI also runs it against the dedicated test database.

## Migration and validation

Migration 1794103000000 advances schema revision to 5, grants owner inventory permissions and adds the posting boundary. Application startup never runs migrations. Downgrade is refused once any stock posting exists, so a schema rollback cannot discard physical movement history.

Real PostgreSQL/HTTP tests cover scopes/default denial/CSRF, concurrent retries, changed-key payloads, opening uniqueness, concurrent deductions, multi-line rollback, balanced transfer and reversal, inactive SKU handling, audit failure rollback, restricted SQL privileges, permission revocation before cached retry, scoped history and ledger reconciliation. Browser QA uses disposable products/users/locations in the dedicated test database; development business stock is not seeded.

## Purchase-linked movements

[PO receipts](PURCHASE-RECEIPTS.md) post through the same stock core in one database transaction. Their stock history identifies the purchasing source and disables generic reversal; corrections must use Purchasing so remaining order quantities and stock stay consistent. The public stock wrapper rejects these generic reversals even through direct SQL. The previous posting core is now owner-only; runtime credentials cannot execute it or write receipt tables. The receipt migration restores delegated stock execution privileges on an empty rollback and refuses rollback once receipt history exists.
