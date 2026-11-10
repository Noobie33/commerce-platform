# Website publication and display-photo approval

Schema 19 adds a bounded R2 release workflow. It is a local development capability, not the public storefront, checkout or production deployment. No existing product is automatically approved or published.

## Staff workflow and responsibility

Catalog > select product > Website publication shows the current release, preparation issues, photo approvals and paginated immutable decision history. Prepare and approve content in Product content & review first. Category and ancestor URL names must be prepared and active. Every active photo needs explicit approval and descriptive alternative text; one must be primary.

Global catalog.media.review authorizes display-photo approval and revocation. Global catalog.publish independently authorizes publication and withdrawal. Both require global catalog.read; location-only grants do not authorize these operations. Owner initially receives both permissions, without silently granting them to other staff roles. Content approval alone grants neither action. Ordinary staff assignment/role administration remains a separate feature.

Each decision requires a reason and current revision. Photo approval verifies both display and thumbnail bytes, binds their SHA-256 hashes and stores alternative text. The original remains private and is never eligible for the public media route. Approval is an explicit decision by an authorized reviewer, not an automatic side effect of uploading or approving content. The owner can hold both permissions; the history identifies each separate decision.

Publishing also requires the current approved content fingerprint and exact content/catalog revisions, active and prepared category ancestry, complete content checks, and all active display-photo approvals. Missing or changed files block a new release. Incomplete work can remain private indefinitely. Current release status uses the existing authenticated live-update mechanism; dirty forms pause reconciliation and retain other edited photo descriptions during a decision. Background checks do not renew idle staff sessions.

## Versioned releases and revocation

A release freezes an allowlisted customer-facing snapshot: identity/style, customer description, BDT SKU options/prices, typed specifications, selected guide/collection content, category path, optional SEO and approved photo IDs/dimensions/alternative text. It excludes operational descriptions, stock quantities, supplier costs, staff/customer records, local storage paths, originals and integrity hashes. Size-guide and collection definitions are already customer-facing content reviewed through the content workflow.

Recorded publication and current eligibility are distinct. Anonymous reads recheck approved content/version/fingerprint, category-path identity, current media-review state/version/hashes and completeness. A changed price/content/photo/category path, retired linked content, revoked media approval or explicit withdrawal closes access to the old release. Reapproving a photo does not silently reactivate it: its new review version requires another explicit publication. Replacing content approval also requires another explicit publication. Restoring exactly the same operational facts without changing content or media-review revisions can make an unchanged release eligible again; this is a predicate over current approved facts, not an automatic permanent withdrawal event. Use Unpublish for a persistent withdrawal.

Unpublish works even when a recorded release is currently blocked. History and retained files remain intact. Revocation prevents subsequent requests; it cannot erase a copy already downloaded by a customer. Endpoints use no-store and do not enable a CDN cache or static media directory. A future CDN requires a tested invalidation/access policy before deployment.

## HTTP boundary

Staff session, Origin, CSRF and action permissions protect all writes:

- GET /api/v1/catalog/products/:id/publication?page=1
- POST /api/v1/catalog/products/:id/publication with publish/unpublish, expected release revision, reason, and content/catalog revisions for publishing
- POST /api/v1/catalog/products/:id/publication/photos/:photoId with approve/revoke, expected photo-review revision, reason, and alternative text for approval

Anonymous read-only endpoints are separate from staff APIs:

- GET /api/v1/store/products/:slug returns only a currently eligible release and public derivative URLs.
- GET /api/v1/store/photos/:photoId/image or /thumbnail requires that photo to belong to a currently eligible release. Each response verifies actual bytes against the approved hash. Draft, withdrawn, removed, unapproved, missing or changed media returns 404.

No public original, anonymous write, customer session, storefront listing, stock promise, cart or working checkout is introduced. The existing local server binds to 127.0.0.1; these routes do not deploy a site to the internet. Public request limiting, performance budgets, monitoring, TLS/hosting and production recovery remain launch gates.

## Database and consistency

Migration 19 is additive: media-review state, release state, immutable decision events and idempotency cache. Existing migrations 1-18 and content fingerprints are unchanged. Runtime receives SELECT and narrow function execution; direct writes to these new tables remain denied. Functions fix search_path and qualify relations, revoke PUBLIC execution, and recheck active/onboarded staff/global permission before cached replay.

Request-key locking binds body and actor. Product-row locking serializes approval/revocation/publication with product/media/content writes; publication also coordinates category mutation and locks variants/photos. Expected revisions reject stale decisions. Snapshot, state, event, audit and minimal replay result commit together. Audit failure rolls everything back. Concurrent publication and media revocation must finish with public access closed when revocation commits. Private event/replay data is never returned by the anonymous endpoints.

Downgrade refuses to discard any publication history/state. Empty schema down/reapply is tested. There is no physical purge or rewriting of approved history.

## Verification and operations

Run npm run publication:verify-local after building. It reports aggregate reviewed-photo, recorded-published/currently-available and invalid-history counts without private content or credentials. A blocked release is legitimate work needing review, not corrupt history. CI runs the same invariant check against the disposable database.

Strict types, full API/admin build, 57 database-free/interface checks and 244 reported PostgreSQL checks passed. Final indexed migration definitions passed a further 14 focused PostgreSQL checks. Coverage includes private drafts, independent permissions/CSRF, actual derivative delivery, raw SQL write denial, concurrent retries, stale edits, corrupt bytes, current price/category changes, approval revocation, simultaneous publish/revoke, audit rollback, fresh permissions before replay and migration retention/down/reapply.

A disposable browser flow approved a real processed photo, published a reviewed product, verified anonymous product/image/thumbnail responses, revoked approval and verified all old public responses returned 404. At 390px, reapproval, a new release and explicit withdrawal worked without document/dialog/control overflow. Original file routes remained authenticated. The temporary staff/product/image fixtures were removed.

A schema-18 backup was restored on an isolated loopback PostgreSQL instance with all 63 table/sequence fingerprints matching. Development advanced once to schema 19 with 55 existing data-table fingerprints unchanged, exactly two new permission/owner grants, and a no-op repeated migration. No real product or photo was automatically published. Main readiness, /admin, linked JS/CSS and the separately loaded publication-panel bundle returned 200.

Development cutover requires a fresh restore-verified schema-18 backup, unchanged fingerprints for all existing operational tables, exactly two new permission/owner grants and a no-op repeated migration. Test fixture images and users are disposable and are removed afterward; development receives no sample release.

No dependency or hosting purchase is required for this slice. Next work includes remaining staff administration, controlled attributes/facets, mixed video media and the Aarong-aligned public templates. Production readiness still depends on the complete retail and operational launch gates in the master plan.
