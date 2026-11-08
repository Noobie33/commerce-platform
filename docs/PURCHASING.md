# Suppliers and purchase orders

This local increment implements the purchasing foundation and staff UI at `/admin#purchasing`. No new dependency or paid service is required.

## Included

- Supplier directory with searchable pages, immutable unique codes, contact/address/tax-reference fields, notes and active/inactive status.
- Supplier edits use optimistic versions, atomic audit and idempotent retries. Inactive records remain available for history.
- Purchase orders have a generated stable document number, supplier, active warehouse/store delivery location, optional delivery date/reference/notes and 1–25 distinct SKU lines.
- Drafts can be edited. Issue freezes supplier contact details and SKU/name/attribute snapshots, quantities and purchase unit costs. Issued records can be cancelled with a reason after all active receipts have been reversed, not rewritten. Cancellation retains the original lines and issue details.
- Server searches and pagination, exact goods subtotals, read-only roles, review-before-save/issue forms and preserved retry keys.

## Why these boundaries

Purchase orders express planned buying. They do not mean goods arrived or a bill became payable. Saving, issuing or cancelling a PO therefore does **not** post inventory, create a supplier liability/journal, allocate payment or send a message to the supplier. The interface states these boundaries explicitly. Existing independent stock receipts remain available in Inventory.

[Partial goods receipts](PURCHASE-RECEIPTS.md) now connect issued PO lines to atomic stock postings, enforce remaining quantities and provide controlled whole-receipt reversals. Supplier invoices, returns, payment allocation, tax/landed cost and valuation require separate financial rules and tests. The goods subtotal displayed here excludes tax, delivery and other charges; it is not an invoice or a payable balance. No placeholder due or payment figures are shown.

Purchasing prices are separate from catalog selling prices. BDT money crosses the API as decimal strings and is calculated using integer minor units/BigInt, never binary floating point. Unit cost is bounded by 999,999,999,999 minor units; a complete goods subtotal by 99,999,999,999,999. Whole-piece line quantities are 1–999,999,999. Other currencies, fabric units and conversions need explicit later policy.

## Access and integrity

This slice uses explicit **global** `purchasing.read` and `purchasing.manage` permissions. Supplier identity/contact data and procurement costs form shared company master/commercial data. A location-scoped grant does not authorize these global routes. Receiving now adds dedicated location-scoped action permissions, but this initial order-detail workflow still requires global purchasing read and therefore exposes commercial order details. A cost-blind warehouse workflow remains future work. The purchasing location picker returns active location IDs/names/codes only, without stock quantities.

Every write requires current staff authentication, same-origin JSON, CSRF and a UUID idempotency key. Permission checks happen before returning a cached response. A transactional retry record compares actor and canonical normalized payload hash; duplicate concurrent submissions return one result. Edits and issue/cancel lock the document and require its current version, preventing stale overwrites. Audit and data/retry response commit together; audit metadata omits supplier contact details and prices.

Supplier codes and document numbers remain stable. Draft lines are replaceable only inside the locked draft transaction. Issuing revalidates active supplier/location/variants, takes fresh supplier and product descriptions and preserves them in the issued document. The supplier row is shared-locked while preparing the snapshot. Location/SKU active-state checks follow the existing inventory rule: an already validated operation is not retroactively cancelled by an in-flight master-data edit. Future location administration must coordinate that policy explicitly.

Database triggers independently reject changes to issued/cancelled header content and line edits/removal. The restricted runtime role cannot delete orders/suppliers or update/delete retry history. The migration owner remains a privileged maintenance actor; a narrowly scoped owner-only line-delete path permits disposable test cleanup without disabling triggers. Application credentials cannot use that path. Migration credentials must never be used by business endpoints.

The migration downgrader refuses to discard existing supplier/order records. Document numbers use a PostgreSQL sequence; rollback may leave harmless gaps, so these are internal order references rather than legally gapless fiscal invoice numbers.

## API and validation

All routes below are under `/api/v1/purchasing` and require the relevant global permission:

- `GET/POST /suppliers`, `GET/PATCH /suppliers/:id`.
- `GET /locations`, `GET /variants?search=...` for preparing an order.
- `GET/POST /orders`, `GET/PATCH /orders/:id` for draft documents.
- `POST /orders/:id/issue` with `expectedVersion`.
- `POST /orders/:id/cancel` with `expectedVersion` and a required reason.

Strict field allowlists reject mass assignment; bounded literal searches do not expand SQL wildcards. Dates are validated as real calendar dates in 2000–2199. Prices reject exponent syntax, negative values, floating JSON numbers and more than two decimals. Duplicate SKUs, inactive masters and excessive totals are rejected before mutation. Business queries use parameters and errors do not expose SQL parameters or credentials.

## Verification

Real PostgreSQL/HTTP integration tests cover global/default/read-only/CSRF denial, concurrent retries, immutable codes, stale edits, exact monetary totals, invalid input, rollback of failed draft replacement, active-master checks, issue snapshots, unchanged inventory, SQL protections for issued data, cancellation, audit-failure rollback, literal search, pagination and migration apply/revert in a scratch schema. Browser checks use disposable users, suppliers, locations and products in the dedicated test database; no business suppliers/orders are seeded into development.

Read-only reconciliation: `npm run purchasing:verify-local` checks goods subtotals, issued snapshots, receipt/stock links and quantities, receiving revisions, over-receipts, reversal links and active receipts on cancelled orders. It never repairs or deletes records. CI runs the same check in the isolated test database.
