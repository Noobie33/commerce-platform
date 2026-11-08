# Recorded supplier statements and aging

## Scope and report basis

Purchasing / Statements & aging provides a company-wide supplier aging report, a supplier/date-period statement, historical outstanding invoice pages and a CSV download of statement activity. The supplier payment workspace also opens its statement. This is read-only: no new migration, dependency, paid service, business mutation, payment or audit posting is introduced. Schema revision remains 9.

These reports cover only invoices and fully allocated payment records in this system. There are no imported opening balances, advances, supplier credits/returns, withholding or complete statutory/general-ledger balances. The statement's brought-forward amount is the net of earlier recorded events; it is not a newly entered opening balance. Amounts use BDT minor-unit integers/BigInt throughout; signed cent formatting is preserved.

Historical cutoffs use persisted recorded timestamps, not document dates. A backdated document entered later is excluded from an earlier recorded-time cutoff. Invoice/payment creation before the exclusive next-day cutoff is included; a reversal at or after that cutoff does not reverse the earlier day's balance. Invoice date, due date and payment date remain visible separately. Future-dated supplier invoices already recorded are included as recorded obligations and normally fall in not-due aging. Future report cutoffs are rejected.

All calendar boundaries and display times use Asia/Dhaka. For example, 2020-04-01 18:00 UTC is the start of April 2 in Bangladesh and is excluded from April 1. Cutoffs apply to stored transaction timestamps, not a separate archive of signed report runs. Each request produces a fresh database snapshot with a generation time; today's later activity or authorized source maintenance can change a regenerated report. No historical master-data archive is claimed: supplier headers/search use the current supplier directory, including inactive suppliers; document references remain as recorded.

## Balances and aging

At a cutoff, active invoices are those recorded before it and not reversed before it. Paid is the sum of allocations from payments recorded before it and not reversed before it. Outstanding is their exact remaining amount. Future reversals are ignored for earlier cutoffs. Current balance views cannot be substituted for these historical queries.

Days past due = selected calendar day minus invoice due date. Remaining amounts are placed in exactly one bucket: not due/due today (zero or negative days), 1–30, 31–60, 61–90 or over 90 days. Fully paid/reversed invoices do not inflate the outstanding invoice count. No interest, penalty, tax or new liability is inferred. Company totals include all matching suppliers, across every page, and inactive suppliers remain included when they have recorded outstanding amounts.

A statement combines four event types: invoice recorded (+), payment recorded (-), invoice reversed (-), payment reversed (+). It shows period brought-forward, total increases, total reductions and closing balance. Reversals retain original document dates and references while their recorded timestamps identify when the correction was entered. Closing balance is reconciled to the historical invoice/allocation calculation, and brought-forward + increases - reductions must equal closing.

Entries sharing one recorded timestamp show the same closing balance for that time group, using a RANGE cumulative window. This avoids inventing an intra-transaction order or temporary negative balance where multiple atomic operations share PostgreSQL's transaction timestamp. Event IDs break display/page ties deterministically; a shared-timestamp label is shown. Balance windows cover the entire supplier history before pagination, so later pages do not restart the balance.

## Snapshot, access and failure behavior

Every report is assembled in one REPEATABLE READ transaction. Context, source validation, totals, events and invoice pages use the same snapshot even if a payment changes between queries. Tests perform a real committed payment change between statement queries to verify this. Separate HTTP pages and CSV downloads are fresh snapshots; a report generation time is shown rather than claiming the browser and a later download are the same immutable export.

Global payables.read and purchasing.read are both required; read-only users need no payment write permission. Location-scoped permissions cannot authorize global commercial reporting. Fresh session/permission checks apply to JSON and CSV on every request. Responses use no-store, and query validation rejects unsupported fields, duplicate date parameters, invalid calendar dates, future cutoffs, inverted periods and invalid pages.

Source validation rejects negative/overpaid balances, active payments with mismatched allocation totals or invalid supplier/historical-invoice links. A statement also checks its independent event/allocation closing totals. Inconsistencies fail with REPORT_RECONCILIATION instead of returning a misleading balance or CSV. Reports never repair source data.

## API and bounded export

- GET /api/v1/payables/reports/aging?asOf=YYYY-MM-DD&search=&page=1 returns 20 suppliers and full filtered totals. Default cutoff is today in Bangladesh.
- GET /api/v1/payables/suppliers/:id/statement?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&invoicePage=1 returns 20 activity entries and 25 outstanding invoices per independent page. Default period starts on the first day of the selected end month; default end is today.
- GET /api/v1/payables/suppliers/:id/statement.csv?from=YYYY-MM-DD&to=YYYY-MM-DD downloads the entire selected activity period, with brought-forward/period/closing summary rows, not merely the visible page. More than 5,000 events returns REPORT_EXPORT_TOO_LARGE and asks for a shorter period. Paginated JSON remains available for larger histories.

CSV uses UTF-8 BOM, CRLF records, quoted/escaped cells and BDT decimal strings without thousands separators. Supplier names, references, reasons and actors are treated as untrusted spreadsheet text: leading whitespace/formula characters and leading tab/newline control entry points are prefixed with an apostrophe to prevent spreadsheet formula execution. Bengali, commas, quotes and embedded line breaks are preserved. A controlled supplier code and date form the download filename. Export does not transmit records to a third party.

## Verification

Real PostgreSQL/HTTP tests cover global/scoped/anonymous/read-only/revoked access, all aging bucket boundaries, fractional cents, historical payment/invoice reversals, backdated documents, Bangladesh midnight boundaries, nonzero brought-forward with empty periods, time-group balances, 22-supplier pagination, independent activity/invoice pages, repeatable-read consistency during a committed source change, immutable business counts/revisions/audits, CSV encoding/formula safety/all-page completeness, reconciliation failure and a 5,001-event export bound. Synthetic historic timestamps and bulk histories are created only by the migration owner in the disposable test database, then removed. Existing stock/invoice/payment integration checks and local reconciliation remain required.

Browser verification completed with disposable test records: five invoices in all five aging buckets, current outstanding BDT 8,950 and a historical 2026-10-01 cutoff of 9,950 before payments. Opening a statement from an aging row retained the selected cutoff. A July–November period showed increases 10,450, reductions 1,500 and closing 8,950, including a payment reversal. Unapplied date edits disabled export. Native CSV download succeeded; its BOM, CRLF, five invoice rows, two payment rows, one reversal row and closing total were inspected from the saved file. The 390px statement kept its three footer controls inside the dialog, contained both long tables, and the company report avoided document overflow. A statement opened from supplier payments formed two native dialogs without nested forms; Escape returned to the parent. Desktop rendering, report totals and all four populated-data source reconciliations passed with no browser console warnings/errors. Disposable fixtures were removed after QA; no development business data was seeded.
