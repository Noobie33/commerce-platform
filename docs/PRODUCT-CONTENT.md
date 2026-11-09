# Product content and review

Implemented: 9 November 2026 (content schema 14), strengthened by integrity schema 15. Final verification: 10 November 2026. This is R2a of the [retail-only roadmap](RETAIL-ONLY-MASTER-PLAN.md), not the completed public storefront or the whole R2 phase.

## Staff workflow

Open Catalog, select a product, then **Product content & review**. Prepare a customer-facing description, a unique lowercase product URL name and a product type. The initial versioned types are Clothing, Accessories and Lifestyle. Clothing supports material, fit, care, neckline, sleeves, finish and optional reference garment length; the other types support material/care/finish and relevant dimensions/weight. Measurements are decimal strings with explicit cm/g units, not floating-point values or a substitute for size-specific/body measurement guides.

The type explicitly chooses the field group. It is not inferred from category names; category-to-profile assignment and configurable category taxonomies remain later work. Product specifications remain separate from stock-bearing SKU size/colour attributes, prices, procurement and stock history.

Save an incomplete draft freely. Submission requires an active catalog product, active category, active SKU, primary product photo, URL name, customer-facing description and the type's required fields. Invalid enum values, unknown specification keys, invalid decimals, oversized text and state/actor assignment are rejected. This is a content-review checklist; later publication gates must also cover size guides, public media, accessibility, SEO and all remaining storefront requirements.

A submitted copy is frozen. A preparer can withdraw it with a reason; a reviewer can approve or request changes with a reason. Requested changes return to preparation. Ordinary staff cannot approve content they edited or submitted. An owner with review permission may self-approve deliberately with a mandatory reason; this exception is explicitly recorded in audit metadata. Staff/role administration and MFA still need their separate implementation before operational launch.

## Permissions and privacy

Global catalog.read permits the protected content view, staff preview and paginated history. Global catalog.content.manage separately permits preparation/submission/withdrawal. Global catalog.content.review separately permits approval/change requests. Location-only grants do not authorize global content work. Catalog price editing is not implied by either new permission. Existing owner roles receive the two permissions through the migration; other roles do not silently gain them.

Every API uses the existing staff session and JSON/Origin/CSRF protections. SQL rechecks active/onboarded staff and global action permissions before idempotent replay. Runtime has SELECT plus narrow function execution; it cannot directly edit content state, review history, profiles or request caches. Public function execution is revoked.

Customer-facing description is deliberately separate from the existing operational product description. Safe staff preview snapshots allowlist name, style/category, customer copy, specifications, active SKU options/prices and photo IDs/dimensions/derivative hashes. They exclude supplier costs, staff/customer records, private original-file metadata and storage paths. Photos remain behind the existing authenticated media routes. There is no public content API, storefront publication action or public original download in this slice.

## Review identity, retention and concurrency

Content has its own monotonically increasing revision and request namespace, independent of catalog revision. Request hashes include product/action/expected revisions and body. Identical concurrent retries produce one content revision/event/audit and return only productId/version/state. Changed bodies or actors cannot reuse a key. Fresh permissions remain mandatory for cached replies. A cached response describes the historical action, not current publication eligibility; the UI reloads current state after a write.

Submission stores an exact snapshot and fingerprint. Approved copies are usable only when state is approved **and** the fingerprint still matches the current projection, with future publication gates also satisfied. Product/category/status, active variants/options/prices and photo changes invalidate the current-review flag. This also detects price/category/photo changes that do not bump catalog revision. Historical approval state remains a fact; the UI adds a needs-review warning and can prepare a fresh draft. Historical previews retain the old price and copy, while new preparation uses current data.

The write function locks request key, product, content, category, variants and photos in a defined order. Expected content/catalog revisions prevent stale saves. Content/state changes, immutable event snapshots, audit and the minimal request cache commit together. Audit failure rolls back the entire operation, preserving the request key for retry. Read views use one repeatable-read transaction.

Schema 14 is additive: profiles, current content, versioned events and request caches. Existing catalog/media/SKU/stock/financial data is not backfilled, rewritten or automatically approved. Applied migrations 1-13 are unchanged. Profile v1 definitions are migration-owned immutable metadata; change field semantics by introducing a new versioned profile code, not editing released v1 in place. Schema 15 adds explicit snapshot/fingerprint NULL pairing and a mandatory submitter for submitted/approved copies. This avoids SQL CHECK accepting UNKNOWN for a partial record. Neither applied migration 14 nor its business data is rewritten. Downgrade refuses to discard content history or weaken review integrity; empty schemas can revert/reapply safely.

## Verification and operations

The focused HTTP/PostgreSQL suite covers protected previews, independent/scoped permissions and CSRF, incomplete drafts, typed validation and direct SQL denial, duplicate/concurrent requests, stale forms, frozen submissions, reasoned review, safe snapshots, changed-data invalidation, self-review rules, audit rollback, revocation before replay, history pagination and migration apply/down/reapply while preserving existing catalog rows. Unit tests validate canonical copy and action-specific request/query limits. The complete existing retail/inventory/purchasing/identity regression suite remains required.

A fresh private schema-13 backup was restored to a disposable loopback-only PostgreSQL instance using existing tools; all 50 public table/sequence fingerprints matched. Development then advanced to schema 14 with all 45 non-migration/non-permission existing objects unchanged. Only the expected schema/permission metadata and new content tables were added; no sample products or content were inserted into development.

`npm run content:verify-local` reports aggregate draft/review/approval counts, stale review copies and invalid content/history/cache invariants without printing content or staff identity. Stale review copies are legitimate work needing re-review, not corrupt history. CI runs the equivalent check against the isolated test database. Production encrypted/off-machine backups, recovery targets, monitoring and deployment rehearsals remain separate launch work.

## Browser acceptance

Disposable test-only records exercised Catalog ? content draft ? submit ? owner reasoned approval. The draft had material/care/fit and a 72.50 cm reference length. Review version 3 preserved BDT 1,290.00; changing the QA catalog price to BDT 1,390.00 marked that approval stale. A fresh draft/submission/approval reached content version 6; historical version 3 still previewed BDT 1,290.00, and the current preview showed BDT 1,390.00.

At 390px, page and dialog widths were both 390px and mobile re-review completed successfully. At 1280px, the dialog was 900px wide with no page overflow and browser error logs were empty. The preview tab/viewport were cleaned up and exact QA records, session and image files removed. Development received no sample content.

## Remaining scope

Versioned size guides and collection assignments are now implemented in schema 17; see [workflow and safety rules](SIZE-GUIDES-AND-COLLECTIONS.md). Next: category vocabulary/SEO, public-media approval and explicit publication, video processing, search/facet projection and the Aarong-aligned storefront templates. Content approval alone does not activate a public product. Retail confirmation, firm stock allocations, payments/COD/courier settlement, return/refund controls and customer-facing account/checkout remain later phases.
