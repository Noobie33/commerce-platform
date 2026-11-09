# Customer records and configured credit policy

> **Scope update - 9 November 2026:** The [retail-only master plan](RETAIL-ONLY-MASTER-PLAN.md) is authoritative. Wholesale/B2B and customer trade credit are excluded from the target system. Existing implementation details below remain accurate until the planned forward migration; this documentation change does not remove features or alter business data.

## Scope and reasons

A dedicated Customers module separates people/business contacts from purchasing suppliers. A customer may be retail, wholesale or both; these are classifications, not separate identity records. Immutable automatically numbered `CUST-…` codes avoid manual numbering collisions. Sequence gaps after aborted transactions are expected. Referenced records are deactivated rather than deleted.

Optional phone/email allow name-only walk-in records. Bengali digits and common Bangladesh mobile formatting normalize to an international phone string. Explicit international contact numbers are accepted; this does not add an international shipping market. Shared family/business contacts are allowed. An authorized, bounded exact-contact lookup warns of potential duplicates without merging or blocking records. Search treats `%`, `_` and backslash literally. List/filter/count results share a repeatable-read snapshot, with 20 rows per page.

Billing and delivery addresses are independent Bangladesh addresses, with optional four-digit postal codes. Copy billing address is an explicit one-time copy. No country selector or sub-brand model is introduced. Future sales must freeze document contact/address snapshots rather than rewriting historical documents after profile edits.

## Separate credit control

`customers.read` permits global directory/profile/contact lookup. `customers.manage` plus read permits profile changes. `customers.credit.manage` plus read separately permits policy changes and credit history. Location-only grants do not authorize shared customer access. Credit managers need not be allowed to edit contacts. A configured policy consists of enabled/disabled state, exact BDT limit and 0–365 payment-term days. Enabling requires a positive limit and an active customer; disabling requires zero limit and terms. Deactivation preserves existing policy and history, but future sales must require an active customer and recheck current policy.

The UI reviews changes before confirmation. Every credit change requires a reason and expected version, preserving previous/current policy, actor and recorded time. Generic audit metadata contains only entity ID and version, avoiding duplicate contact/notes/address data in general activity. These settings do **not** represent receivables, available credit, an accounting journal or a payment. Sales/receivables must later calculate outstanding amounts and enforce credit atomically at order approval/posting; that workflow is not yet implemented.

## Write boundary and privacy

Migration 10 adds customers, policy history and a dedicated request namespace. Runtime has SELECT access and one narrow SECURITY DEFINER save function, with fixed `pg_catalog` search path and qualified application tables. It cannot directly insert, edit or delete customer/history/cache rows, nor use the customer sequence. The save function checks fresh global access and active/onboarded actor before replay, locks request keys and customer revisions, and commits profile/policy/history/audit/minimal retry result together. Unknown fields, credit mass assignment and code changes are rejected. Retry keys belong to the original actor and canonical payload; a replay returns `{id,version,kind}` without storing another PII snapshot. HTTP reads use no-store caching. Raw addresses, notes, phones, email and reasons are not included in general audit metadata.

There is no customer portal, bulk export, automated contact message or marketing consent flow yet. Access is staff-only. A production retention/erasure policy, encryption/backups/restore and operational access reviews remain deployment work; this is not a production-readiness claim.

## Verification and recovery

Real PostgreSQL/HTTP tests cover normalization, optional/shared contacts, strict payloads, independent global permissions/CSRF, stale/concurrent edits, concurrent retry/code generation, policy history/exact money, inactivity, audit-failure rollback and same-key retry, direct-DML denial, fresh permission revocation before replay, and compiled migrations in an empty scratch schema. Rollback refuses to discard any customer records. Do not delete customer rows or roll migrations back to repair live data; use a reviewed forward migration or complete tested backup restore.

`npm run customers:verify-local` reads counts and checks code/contact format, current policy against the last history record, history version bounds and minimal retry response shape. It prints no customer names or contact data. The disposable browser fixture uses only `commerce_platform_test` and removes its own customers/history/requests before deleting its staff account. Development receives no sample customers.

Browser QA verified customer creation with Bengali contact/postal digits, explicit independent address copy, shared-contact warnings, exact policy review and history, profile deactivation/inactive filtering, desktop directory and 390px forms/directory with contained table scrolling. The corrected address view explicitly orders address lines, area, district and postal code instead of relying on JSON object key order. All QA customers are disposable test-only records and were removed afterwards.
