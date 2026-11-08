# Supplier payment records and invoice allocation

## What this increment does

Purchasing / Supplier payments opens suppliers with recorded invoices and their outstanding invoices, payment history and exact totals. An order's invoice panel also opens that supplier's payments. One payment can allocate to 1–25 invoices across several purchase orders for the same supplier. Partial payments and subsequent completion are supported; a payment must be allocated in full to the invoices selected from the current 25-invoice page. Unallocated advances, deposits and cross-supplier allocations are rejected.

This records a payment already made. There is no bank/mobile-wallet connection, transfer, refund or external notification. Method (cash/bank/mobile), a short source label, actual payment date, company-wide payment/voucher reference, exact BDT amount, allocations and reason are required. Source is descriptive, not a bank-account balance or general-ledger account. Do not enter credentials. Payment date must be on/after every selected invoice date and no later than today in Asia/Dhaka. A scheduled future payment is not treated as money already paid.

Active references are case-insensitively unique company-wide, across suppliers and methods. Use a consistent provider/voucher reference with a provider prefix when needed. Reversing a mistaken record permits a corrected record with that reference while keeping both in history. This is a duplicate-document safeguard; it does not reconcile against actual bank statements. Staff remain responsible for matching real payment evidence.

## Amounts, correction and balance meaning

Amounts are decimal strings at the HTTP boundary and integer BDT minor units in SQL/BigInt. Each positive allocation must fit the active invoice's remaining amount; their exact sum must equal the recorded payment. Maximum document amount is 99,999,999,999,999 minor units. No floating-point calculations or silent rounding are used.

Paid = allocations from unreversed payment records. Remaining = active invoice total minus paid. Unpaid/partially paid/paid are derived states, not manually editable flags. Invoice searches now support these states and overdue (due date before today in Bangladesh with remaining amount). Order and supplier outstanding totals include recorded payments and exclude reversed invoices. They cover only records in this system, not opening balances, supplier credits, returns, withholding, advances, bank fees or a complete statutory supplier balance. Do not infer a bank/cash balance or finalized accounting/tax ledger.

A whole-payment reversal retains its original allocations, amount, date, reference, source and actor, records a new actor/time/reason and restores every affected invoice balance atomically. It does not undo an external bank transfer or issue a refund. A consolidated payment reversal affects all its allocated invoices; the review lists all of them. To correct an invoice with any active payment allocation, reverse the allocated payment records first. The existing receipt/invoice protection then continues to require invoice correction before a physical receipt reversal.

## Concurrency and database boundary

Migration 1794107000000 advances schema revision to 9 without rewriting old migrations. Runtime credentials can SELECT payment/allocations/revision tables and an invoker-security invoice-balance view, but cannot INSERT/UPDATE/DELETE those tables. The narrow supplier_payment_post function is SECURITY DEFINER with fixed pg_catalog search path and qualified table references. A separate trigger protects invoice reversal against active allocations even through the invoice posting function.

The purchasing idempotency namespace locks/checks a UUID request key and compares actor plus canonical payload hash. Fresh active/completed-onboarding/global permissions are checked before cached replay. A supplier lock serializes payment operations and a separate supplier payment revision rejects stale allocation forms. PO rows are locked in stable UUID order across consolidated allocations, matching invoice posting/reversal's serialization boundary. Invoice rows and remaining amounts are rechecked after locks. A payment racing an invoice reversal cannot allocate to a reversed invoice. Payment, allocations, supplier revision, audit and retry response commit in one transaction; any error rolls back all of them.

Global purchasing.read and payables.read are required for commercial reads. Recording additionally requires global payables.pay; reversing requires global payables.reverse_payment. Invoice management/reversal alone does not grant payment rights. Location-scoped grants do not authorize global commercial actions. Inactive supplier master records remain payable against existing valid invoices; history is retained. Downgrade refuses any payment history, including reversed records.

## API and checks

- GET /api/v1/payables/payment-suppliers?search= returns at most 20 matching suppliers with invoice history, including inactive masters.
- GET /api/v1/payables/payments?search=&status=all&page=1 returns 20 records and the filtered total of active payment amounts.
- GET /api/v1/payables/suppliers/:id/payments?page=1&invoicePage=1 returns a supplier summary, independent 20-record payment history and 25-record outstanding invoice pages, payment revision and current action flags.
- POST /api/v1/payables/suppliers/:id/payments records a reviewed, fully allocated payment.
- POST /api/v1/payables/payments/:id/reverse reverses an entire record with expectedRevision and reason.

Writes retain existing same-origin JSON/CSRF/UUID X-Idempotency-Key protection. Strict allowlists reject mass assignment, duplicate invoice allocations and malformed decimal/date values. Bounded literal searches do not treat user percent/underscore characters as wildcards. Errors do not expose SQL/credentials. Reopening after a stale or over-allocated error gets current balances; an unchanged uncertain network retry retains its key.

payments:verify-local is read-only. It checks allocation sums/counts, supplier/date links, active allocations on reversed invoices, overpaid/negative balances and revision event counts. Invoice/purchasing/inventory verifiers remain independent checks. Tests cover duplicate/stale concurrency, multi-PO allocations, wrong supplier, overpayment, exact totals, date/CSRF/global/scoped/default denial, immutable runtime privileges, invoice reversal races, create/reversal audit rollback, revoked cached retries, reference correction, pagination/older history, inactive suppliers and compiled apply/revert/refused-history migrations. No dependency or paid service was added.

## Remaining financial work

Supplier statements/aging, opening balances and credits/returns need explicit workflows. Full financial accounting still needs account coding, balanced journals, cash/bank reconciliation and policy for tax, withholding and inventory valuation. Do not silently reinterpret historical invoice costs or payment records when adding those workflows. Before remote/production use, backup restore rehearsal, deployment security and operational recovery remain required acceptance gates.

Browser verification completed using disposable test data: two invoices totaling BDT 9,125; one bank payment of 3,000 allocated 2,000/1,000 with outstanding 6,125; a cash payment of the remaining 6,125 deriving Paid for both invoices; reversal of the whole cash record restoring 3,875/2,250 and partial status while keeping history. Mismatched allocation totals showed a warning; nested Escape returned focus to the parent. Three nested native dialogs had no nested forms. The 390px form fit without document overflow and long history tables remained contained. Closing supplier payments refreshed the order invoice panel and the underlying Paid filter. Payment search/reversal filters and all four populated-data reconciliation checks passed; console warnings/errors were absent. Fixtures were removed after QA; no development business data was seeded.
