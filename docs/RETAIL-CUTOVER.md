# Retail-only cutover

Implemented: 9 November 2026. Schema 13. Business direction: [retail-only master plan](RETAIL-ONLY-MASTER-PLAN.md). This is the first implementation slice, not a completed online store or production launch.

## Result

The staff customer editor no longer offers retail/wholesale/both selection or credit-policy editing. People and business billing contacts remain supported at ordinary retail prices. Normal contact/address matching, pagination, version checks, deactivation and audit behavior remain.

The sales editor offers catalog-priced retail drafts only. Wholesale channel selection, negotiated price mode and override reasons are removed. Server validation rejects trade channels and overrides, including when an old client sends them. Omitted legacy segment/channel fields normalize to retail; existing explicit retail requests remain compatible. The retained channel column is a historical discriminator, not a future online/store/staff order-source field.

The customer credit-policy POST endpoint is removed. The old `customers.credit.manage` permission now permits only its existing protected historical-read endpoint, together with customer read. It cannot authorize credit writes. `sales.price_override` no longer authorizes a price override, even for an owner. Permission rows are retained for compatibility/history and labelled accordingly, not silently repurposed into active trade permissions.

## Database enforcement and history

Migration 13 updates the existing customer, sales draft and stock-reservation SQL functions in place. It validates each unique function-body anchor and the schema baseline before replacement. Applied migrations 1-12 stay untouched. Function ownership, ACLs, SECURITY DEFINER, fixed search path, original authorization/lock ordering, atomic audit and request-key machinery are preserved. There is no extra legacy function that runtime could call to bypass the policy.

Customer credit operations and non-retail profile writes are rejected before cached success replay. Existing non-retail profiles cannot be silently reclassified by editing. Sales create/update and cached trade replays reject non-retail channels, override lines and nonempty override reasons. Updating an existing historical wholesale/override draft into a different economic record is prohibited. Catalog-mode amounts still match the current catalog price under existing database locks.

Historical customer segments, credit policies/history, order prices, snapshots, request history and audit records remain unchanged. Read APIs retain historical filter values for finding these records; the ordinary staff editor exposes no trade selectors. Historical trade drafts cannot be edited or receive new holds. Existing holds remain counted until release/expiry. With current permissions and version checks, staff may release them and cancel the draft while preserving its original amounts and lines. No supplier-payable or physical stock history is rewritten.

Valid retail retries retain their previous minimal response and require fresh authorization. Prohibited old trade retries return a policy error instead of returning a success that appears to reactivate a retired operation. Reservation policy is rechecked before cached hold replay and after acquiring the order lock. Its active-customer check now requires a retail profile. Release is deliberately still available for historical commitments.

Rollback refuses to re-enable trade policy while customer history exists. Use a reviewed forward correction; do not delete records to force downgrade. Empty scratch-schema down/up is tested. App startup expects schema 13, so incompatible binaries fail readiness instead of serving against an unexpected schema.

## Data audit and recovery preparation

Before cutover, both local project databases were at schema 12 and had zero customers, credit-history rows, sales orders, override lines and active holds. No real customer/order conversion was needed. These are observations from this cutover, not assumptions for future migrations.

A private custom-format development backup was restored into a disposable PostgreSQL instance bound to loopback with a generated temporary password, using existing installed PostgreSQL binaries. Every restored public-table fingerprint and sequence value was compared with the source; 50 table/sequence objects matched. The temporary server was stopped and its private cluster removed. Existing database roles/passwords were not changed. Backup and verification manifest remain under the ignored `.local-setup/backups/` directory; they must never be committed. This local restore exercise does not replace production encrypted/off-machine backup planning.

## Verification contract

- Unit/HTTP checks reject wholesale/both customer writes, credit-field mass assignment, wholesale sales, override lines and nonempty negotiated-price reasons; optional compatibility fields normalize to retail.
- Full isolated database regression covers identity, catalog/media, stock, purchasing, supplier invoices/payments/reports, retail customers/drafts and timed holds. Customer audit rollback continues to exercise both create and update, with retries preserving HTTP method and request key.
- A dedicated schema-12 upgrade fixture contains actual wholesale/credit history, catalog and override order snapshots, recorded stock and active retail/trade holds. Schema 13 must preserve all business/history rows and function security attributes byte-for-byte at the data level, reject forbidden new/cached writes, preserve authorized retail replay, honor revocation, and allow legacy release/cancellation without changing prices.
- A separate empty-schema exercise verifies compiled apply/down/reapply. No customer data is seeded into the development database for browser QA.

## Browser and local acceptance

The working development database was upgraded to schema 13. Post-migration comparison matched all 47 non-migration table/sequence fingerprints; only schema version, migration history and its numbering sequence changed.

Browser QA used a disposable test-only staff session and records. At 390px, a retail customer saved successfully without segment or credit controls. A catalog-priced draft changed from two to three pieces at BDT 1,250.00, reviewed/saved as BDT 3,750.00 and version 2. At 1280px, the editor had no trade selector or override mode, its price field was read-only, page width equalled viewport width and browser error logs were empty. The temporary tab/viewport were cleaned up and exact test fixtures/session removed. The development database received no sample records.

## Next boundary

R2 begins with a small catalog/content slice: typed category-specific specifications and controlled draft/review/preview/publication contracts, followed by reusable size guides, collections and safe image/video publishing. Staff/role administration required for real employee workflows remains pending. The Aarong-aligned public storefront, confirmed-order allocations, checkout, payments/COD settlement, delivery and returns are subsequent phases; none is implied by this cutover.
