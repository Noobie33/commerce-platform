# Supplier invoice matching

## Scope and decisions

This increment records supplier invoices against physically received purchase-order lines. Open an issued order in Purchasing, then Supplier invoices / Record invoice. The separate Supplier invoices screen searches invoices, supplier snapshots and PO numbers, filters active/reversed documents, and shows the exact total of active recorded invoices matching the filters.

Invoices and physical receipts are distinct: posting/reversing an invoice never posts inventory. Partial quantities can be invoiced across receipts and across multiple invoices; no active invoice can consume more than a receipt's unreversed quantity. Invoice lines are selected from one issued PO per document. This keeps the first matching workflow understandable; multi-PO consolidation, service/expense invoices and advances are later workflows.

The PO unit cost starts the form but the actual supplier invoice may differ. Staff explicitly review actual unit costs, supplier document number, invoice date, due date, tax amount, delivery charge, goods discount and reason. BDT values are decimal strings at the API, integer minor units in SQL/BigInt. Total = goods + tax + delivery - discount, with positive total and bounded exact amounts. Tax is entered from the document; no rate, tax deductibility, tax filing or statutory policy is inferred. Cost variance is visible through the retained PO and invoice values; it does not revalue stock.

These are operational recorded, unsettled invoices. Payments, payment allocations/reversals, opening balances, credit notes/returns, journal/account coding, inventory valuation and a complete supplier balance are not implemented by this increment. The interface does not label the document paid, send money or infer payment from receiving. Complete financial accounting must post balanced journals after the account/tax/valuation policy is defined and verified. Do not use this increment as a statutory ledger or claim a complete payable balance.

## Correction and concurrency

Posted invoice content is immutable to application credentials. A whole-invoice reversal retains all original amounts and lines plus actor/time/reason, removes that document from active recorded totals and releases its receipt allocation. Reversal is a correction, not a supplier credit note or refund. Once payment allocations arrive, they must block invoice reversal until the corresponding payment allocations have been corrected.

An active supplier invoice number is case-insensitively unique per supplier across all purchase orders. Reversing the original permits a corrected entry with the same supplier number; both versions stay in history. Blank numbers are rejected. NFC/trim normalization and strict API allowlists prevent accidental duplicate field interpretations.

Invoice posting and reversing lock the PO row, shared with receiving/cancellation. A separate invoice revision detects stale edits without modifying issued commercial content or receipt revision. The database blocks reversal of any receipt used by an active invoice. If the stock function has already started a reversal, the invoice guard fails the same transaction and rolls back stock, receipt, audits and retry data together. Reverse invoices first, then correct delivery quantities. Inactive supplier master data does not invalidate an already-issued PO or its received goods; supplier details are retained from the PO snapshot.

Writes require a UUID retry key; identical concurrent retries produce one document. Fresh active-user, completed-onboarding and global permissions are checked before cached replay. Request keys share the purchasing namespace, compare actor and canonical payload hash, and commit with document, allocations, revision and audit. Different keys cannot both use one stale revision. Unique supplier-number conflicts also work across different PO locks.

## Permissions, database and API

Global purchasing.read and payables.read are both required to expose procurement costs/supplier documents. Posting additionally requires global payables.manage; reversal requires global payables.reverse. Location-scoped grants do not grant global commercial access. This is not a cost-blind warehouse workflow.

Migration 1794106000000 advances schema revision to 8. The runtime has SELECT only on invoice/header/line/revision tables and executes a narrowly scoped SECURITY DEFINER posting function with fixed pg_catalog search path and qualified table names. It cannot directly insert, update or delete these tables. A database trigger independently prevents reversal of invoiced receipts. Downgrade refuses any invoice history, including reversed invoices. Existing migration files remain unchanged.

- GET /api/v1/payables/invoices?search=&status=all&page=1 returns 20 documents and a filtered active recorded total.
- GET /api/v1/payables/orders/:id?page=1&linePage=1 returns 20 historical invoices and up to 25 eligible receipt lines per independent page, invoice revision and current action flags.
- POST /api/v1/payables/orders/:id/invoices records a reviewed invoice; at most 25 distinct receipt/PO-line pairs per request.
- POST /api/v1/payables/invoices/:id/reverse corrects a whole invoice with expectedRevision and reason.

Writes require the existing same-origin JSON, CSRF and UUID X-Idempotency-Key controls. Errors distinguish stale allocation, duplicate active supplier number, excess quantity, unavailable receipt, permission denial and already reversed invoice. No SQL/credential details are returned.

## Verification

The real PostgreSQL/HTTP suite covers global/scoped/read-only/CSRF denial, duplicate concurrent keys, stale concurrent allocations, exact money, malformed values, over-invoicing, immutable runtime privileges, active-invoice receipt protection, post/reversal audit rollback and retry, revoked permissions before cached replay, supplier snapshot retention, cancellation races, invoice/eligible-line pagination and older document reversal. Compiled migrations are applied/reverted in an empty isolated scratch schema and refuse live-history discard.

invoices:verify-local is read-only: it checks header/line totals, supplier/order snapshots, receipt/order links, active invoices referencing reversed receipts, allocation bounds and revision event counts. Purchasing and inventory reconciliation remain independent checks. Browser verification uses disposable test data, never development business records. No new dependency or paid service is required.

Browser verification completed on the disposable test workspace: two receipt lines (6/8 received), partial invoice (4/5 at BDT 500/750), explicit tax 100/delivery 50/discount 25 and exact total 5,875; over-quantity warning, invoice/due-date review, nested Escape returning to the PO, reversal to zero recorded unsettled, same-number corrected invoice with original history preserved, receipt reversal guidance refreshed after invoice writes, invoice search/status filters and directory-to-order history. The 390px form fit with no nested forms/document overflow, and directory controls were 44px high with contained horizontal tables. Console warnings/errors were absent. Invoice/purchasing/inventory reconciliation passed with sample records present. Disposable fixtures were removed after verification; no development business records were seeded.
