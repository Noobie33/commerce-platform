# Partial purchase receiving

## Workflow and boundaries

Open Purchasing, an issued purchase order, then Receive goods. Enter only the quantities physically delivered now; blank skips a SKU. Ordered, received and remaining quantities appear separately. Receipt history is paginated at 20 records, with review before receive/reverse and preserved reasons, references, actors and stock links. Whole-piece quantities retain existing inventory limits and at most 25 distinct PO lines are accepted per operation.

A receipt updates PO progress, stock movements/balances, both audits and retry records in one transaction. Any failure rolls everything back. Issuing a PO still changes neither stock nor payables. Receipt costs do not create valuation, supplier invoices, tax, landed cost, liabilities or payments. Those financial workflows are the next increment.

Reverse receipt corrects every line of one receipt; it removes the original physical quantities from the same location and restores remaining PO quantities. Insufficient stock blocks the entire reversal. It does not represent a supplier return, refund or reversal of a future invoice. Original receipt and reversal history remain immutable. Cancel requires every active receipt reversed first; the database also enforces this against a concurrent cancellation.

## Why separate receiving state

Issued commercial documents and their supplier/SKU/price snapshots remain frozen. A separate receiving revision serializes partial receipts and reversals without rewriting the PO commercial version. The PO row lock serializes cancellation and receiving. Totals count unreversed receipts only; quantities cannot exceed what was ordered. New receiving requires active stock variants on non-archived products; reversing uses original stock lines. An inactive supplier may still deliver an already-issued order.

Each write requires a UUID retry key. Identical concurrent retries return one result; changed payloads or another actor cannot reuse it. Fresh permissions are checked before cached replay. A non-empty delivery-note reference is case-insensitively unique among active receipts on that order, and becomes reusable after reversal. Blank references are allowed, so the system cannot identify physically repeated deliveries submitted with different keys and no reference; staff must check delivery documents.

## Permissions and database boundary

The initial order-detail screen requires global purchasing.read. Receiving additionally needs purchasing.receive, inventory.read and inventory.receive at the delivery location. Reversing needs purchasing.reverse_receipt, inventory.read and inventory.adjust there. Action grants may be global or location-scoped; a location-scoped purchasing.read alone does not expose commercial order details. This is not yet a cost-blind warehouse workflow. Active staff, completed onboarding and active location are checked at commit.

Migration 1794105000000 advances schema revision to 7. New purchase_receipt_post is SECURITY DEFINER with a fixed search path and qualified objects. Runtime can read receipt tables but cannot mutate them. It calls the existing stock core inside the same transaction. That core becomes owner-only; the public inventory wrapper refuses generic reversal of linked PO receipts. Runtime grant verification also rejects inherited access to the private core. Neither endpoint nor direct runtime SQL can bypass the linkage.

Stock and purchasing retry namespaces are checked together, preventing an old standalone stock posting from being claimed as a new PO receipt. Trigger and function permissions are migration-owned. Downgrade refuses any receipt history, including reversed records; an empty rollback restores previous delegated stock function privileges. No historic migration was rewritten.

## API and reconciliation

- GET /api/v1/purchasing/orders/:id/receiving?page=1 returns quantities, permitted actions and receipt history.
- POST /api/v1/purchasing/orders/:id/receipts accepts expectedRevision, reason, optional reference and orderLineId/quantity lines.
- POST /api/v1/purchasing/receipts/:id/reverse accepts expectedRevision, reason and optional reference; the original receipt determines all lines.

Writes require the existing authenticated same-origin JSON/CSRF protections and UUID X-Idempotency-Key. Errors distinguish stale state, over-receipt, duplicate active reference, missing permission and insufficient stock; SQL details and credentials remain private.

purchasing:verify-local is read-only and checks receipt/order/stock linkage, line quantities, over-receipt, reversal linkage, cancellation consistency and receiving revision counts. inventory:verify-local independently reconciles stock ledger and balances. Real HTTP/PostgreSQL tests cover retry/cancellation races, cross-module key reuse, multi-SKU rollback, audit rollback, scoped/revoked access, restricted SQL privileges, migration rollback refusal/restoration and older paginated receipt reversal. Browser QA uses disposable test-database data only.

Browser verification completed on the disposable test workspace: two-SKU partial receipt (4/7 of 10/20), second receipt to full completion, reversal back to partial (remaining 6/13), over-quantity validation, blocked cancellation with active receipt, nested-dialog Escape/focus return, 390px form with no document overflow or nested forms, and Inventory showing the matching 4/7 stock with purchasing-only correction guidance. Browser console had no warnings/errors. Reconciliation passed with the receipt history populated, then disposable fixtures were removed.
