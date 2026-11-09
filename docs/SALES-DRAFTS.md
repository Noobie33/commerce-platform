# Sales draft foundation

> **Retail-only update - 9 November 2026:** The [master plan](RETAIL-ONLY-MASTER-PLAN.md) is authoritative. [Schema 13 cutover](RETAIL-CUTOVER.md) retires wholesale, customer trade-credit writes and negotiated sales prices while preserving history.

## Implemented boundary

Sales is a separate feature module. Staff with global `sales.read` can search saved sales orders and look up active customers, locations and active sellable variants at their catalog prices. This permission explicitly includes order contact/address snapshots and sales customer lookup; it does not grant customer-profile editing, catalog editing or physical inventory balances. Global `sales.manage` plus read permits creating/editing/cancelling drafts. Location-only grants do not authorize this shared commercial workspace. Stock/fulfillment scope will be enforced separately when those workflows arrive.

The current sales increment supports retail-only drafts, versioned customer selection, a fulfillment location, an optional requested date/reference/notes, up to 30 distinct variants, exact integer quantities and BDT goods totals. An active retail customer is required. Businesses and people use the same identity records. Customer and product details are snapshotted at save. Reading a saved draft does not silently substitute changed customer contacts or product names. Explicit editing/save refreshes the snapshots and checks the customer version.

This is preparation only. Saving a draft does not automatically reserve stock. [Explicit timed stock holds](SALES-RESERVATIONS.md) now reserve/release quantities separately; an active hold must be released before draft edit/cancel. Draft preparation still does not deduct physical stock, post revenue, create receivables, record payments or confirm a sale. The UI states this at entry, review and detail. No confirmation, dispatch, invoice or payment button is presented before the corresponding invariants exist. The total is goods only; taxes, delivery charges, discounts, price lists and promotions are later workflows. The requested date is not a shipping commitment. Customer-facing confirmations or notifications are not sent.

## Prices and reasons

Catalog-price mode compares the submitted reviewed price with the current catalog price under a shared row lock. A changed catalog price fails with an explicit refresh requirement rather than silently repricing an order. `Refresh catalog prices` reloads the selected variants and updates catalog-mode lines; historical override drafts remain read-only. An unavailable product must be removed/replaced.

Negotiated overrides and nonempty override reasons are rejected by API validation and the schema-13 SQL policy, regardless of the old override permission. There is no wholesale price or automatic quantity discount. Historical override/wholesale snapshots stay readable and retain their original totals; new promotions require a separate centrally managed retail workflow.

Money is integer minor units in PostgreSQL and BigInt calculations at validation/review boundaries. Prices accept up to two decimal places; no floats, exponent syntax or rounding are used. Per-unit maximum is 999,999,999,999 minor units and order maximum 99,999,999,999,999 minor units. Quantity is a positive whole number up to 999,999,999. Totals are recomputed from validated lines; clients cannot assign totals/status/numbers. Duplicate variants are rejected, not silently merged.

## Transactions and retention

Migration 11 adds sales orders, snapshotted lines, an owner-only numbering sequence and a dedicated idempotency namespace. Runtime receives SELECT and EXECUTE on one narrow SECURITY DEFINER function with fixed `pg_catalog` search path and qualified application tables. It has no direct DML or sequence access. The function checks fresh active/onboarded global read/manage permissions before cached replay; schema 13 also rejects prohibited trade payloads before replay, locks request keys and order revisions, locks active customer/location/catalog rows while validating, and commits header, line replacement, audit and minimal retry response atomically. Failed attempts consume no retry record; sequence gaps are expected. Unchanged successful retry returns the same `{id,version,kind}`, without another PII copy in general audit/cache.

Cancellation requires a reason and expected version. It preserves number, snapshots, lines and total, records actor/time through the transaction/audit, and prevents further edits. There is no delete endpoint. Migration rollback refuses to discard any sales orders. Use a reviewed forward migration or a complete tested backup restore for recovery, never delete posted history to force a downgrade.

`npm run sales:verify-local` reads counts, line/total consistency, required override reason, snapshot identity, document numbering and minimal retry result shape. It prints no customer identities or contact information. Development receives no sample orders. Browser QA uses a separate temporary staff account and only `commerce_platform_test`; cleanup removes owned sales requests/lines/orders before their customer/catalog fixtures.

## Verification and next acceptance gate

Real PostgreSQL/HTTP checks cover protected bounded lookup, exact multi-line totals, duplicate/concurrent requests, retired override denial even for owners, CSRF, strict inputs/overflow/calendar dates, unavailable or incompatible records, customer/catalog changes, preserved snapshots, concurrent edit/cancel, audit-failure rollback for create/update/cancel, read-only runtime, fresh permission revocation, literal search/pagination, unchanged stock/payables and compiled migration apply/revert/reapply in an isolated schema. Unit checks cover canonical exact amounts, dates and strict input/query boundaries.

Timed holds and available-stock enforcement are implemented. Retail-only policy is enforced at schema 13. The next overall phase is publishable catalog/content; subsequent sales work needs firm confirmed-order allocations, source-linked dispatch, retail invoices, prepaid/COD settlement, returns/refunds and reconciliation as set out in the [master plan](RETAIL-ONLY-MASTER-PLAN.md). Customer trade credit is excluded. Production operations remain separate outstanding work.

Historical schema-11 browser QA verified customer/SKU lookup, wholesale preparation with two variants, exact BDT 6,400.45 total including an authorized override, requested date, review/save, catalog refresh retaining the override, edit and controlled cancellation with preserved lines/totals. Review focuses and scrolls within its dialog. The directory/form/table fit 390px; navigation and directory also fit 1024px and 1280px without page overflow. As the module list grew, medium desktop navigation was arranged into a brand/account row and a wrapping menu row. The preview contains test-only data; all fixtures were removed afterwards.
