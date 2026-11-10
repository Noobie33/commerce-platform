# Private ordered product gallery drafts

Schema 24 adds an editorial draft for a single ordered list of product photos and videos. It does not alter photo/video originals, product revisions, existing reviews, public release functions, release snapshots or public routes. The customer storefront remains a future Next.js application. This is the preparation step before explicit mixed-media release binding and delivery, not a public gallery launch.

## Staff workflow and decisions

Catalog > product > Product gallery. Readers can inspect the private draft, preview authorized photo/video derivatives and view saved-order history. A global catalog manager can add ready media, move items up/down, remove them from the draft, and save with a reason. Removing an item from this order does not remove the source media. An empty order explicitly clears the draft and retains its history. The first save is explicit; existing photos are not silently selected or published.

Keyboard-accessible move controls work on desktop and mobile without requiring dragging. Descriptive text and variant SKU remain visible. Videos use native controls, no autoplay and metadata-only preload. Draft ordering is independent of the primary photo used by existing product cards. A preparation check recommends putting the current primary photo first, identifies unavailable items, missing descriptions/reviews and audio accessibility work. Checks are informational for editorial drafting; zero issues is not a public approval or a file-integrity attestation. Actual playback and image routes continue to verify files using their established staff permissions.

The editor retains unsaved order/reason across background invalidations and asks before discarding. Clean visible panels reconcile through the existing authenticated live channel; dirty forms pause updates. Current-order and media-basis tokens prevent stale changes overwriting another employee's decisions. Saved-order history is paginated and uses Dhaka time.

## Storage and consistency

catalog_gallery_drafts contains the current version and ordered kind/id pairs (at most 40). catalog_gallery_events retains each revision, actor, reason, full ordered IDs, the media-basis fingerprint and timestamp. catalog_gallery_requests stores actor-bound idempotent receipts. These are additive tables with no backfill and no changes to schema-23 video definitions.

catalog_gallery_basis reads active photos/reviews plus non-removed videos, current revisions/metadata/prepared manifests and assigned variant activity. The HTTP response allowlists presentation fields; source hashes, artifact IDs, processing leases and absolute paths are omitted. Its opaque fingerprint detects changes even when the product version itself does not change, such as private video review or worker completion. A token is a concurrency precondition, not authentication.

catalog_gallery_post independently verifies current active staff, global catalog.read and catalog.manage before idempotent replay. It locks the product and relevant media/variants, compares the current order revision and basis, validates every item belongs to the product, rejects duplicates and permits only ready videos assigned to active variants (or the whole product). Draft save, retained event, audit and request receipt commit together. Same-key concurrent retries produce one revision; competing different edits produce a conflict. Runtime can read the new tables and execute the scoped functions but cannot directly edit drafts/history. Video workers receive no gallery grants. Downgrade refuses any retained draft/history/request data.

## HTTP and operational verification

GET /api/v1/catalog/products/:id/gallery?page=1 returns the current draft, available private media, saved-state checks and history. POST receives action=save, expectedVersion, expectedBasis, reason and ordered items plus an idempotency header. Session, Origin, CSRF and permission requirements remain mandatory. There is no anonymous gallery or video endpoint.

Run gallery:verify-local for aggregate draft/history consistency. Database acceptance covers real HTTP boundaries, SQL privilege denial, concurrent same-key and competing edits, media/variant staleness, cross-product IDs, removed media, unchanged product/public release facts, revoked permissions before replay, audit rollback and compiled isolated migration down/refusal/reapply. Browser acceptance uses fictional test-only products and generated media, then removes the fixtures. Main development cutover requires a freshly restore-verified snapshot and unchanged fingerprints for every pre-existing data table.

## Next delivery boundary

Explicit public gallery review, accessibility and audio/caption policy, immutable mixed-media release snapshots, instant revocation, public range delivery/caching and a tested Next.js customer gallery remain required. A private video approval or gallery draft alone cannot publish a video. No paid services, new framework packages, stock/finance behavior or public exposure are introduced by schema 24.

## Completion evidence - 10 November 2026

Local strict types/build/format gates passed, together with 76 unit/interface, 14 real-codec and 309 PostgreSQL checks. Desktop browser acceptance added photo plus real prepared video, moved both directions, saved, inspected reason/actor/history, retained unsaved text after a close attempt, reopened after reload and recovered the stored order. The video decoded at 400x480 with readyState 4 and no media error; user-initiated playback worked and no autoplay occurred. At 390x844, document and dialog were 390px with zero overflowing controls among 18 controls; mobile reorder/save produced revision 2. Desktop/mobile screenshots were saved, viewport restored, temporary tab closed and all fictional rows/files/session removed.

A fresh exported-snapshot backup restored into an isolated PostgreSQL instance and matched all 79 table/sequence fingerprints. Development advanced once from 23 to 24; all 73 pre-existing data-table fingerprints remained unchanged. Main API readiness, admin assets and public browse remained available after the controlled restart. Both development/test gallery and video invariant checks reported zero invalid histories after fixture cleanup. Public mixed-media release and Next.js delivery remain pending.
