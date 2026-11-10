# Category SEO and website preparation

Implemented 10 November 2026, schema 18. This is a bounded R2 increment, not a public storefront or a publication release.

## Category identity and navigation

Catalog > Categories & SEO manages category names, parents, active status and optional search appearance. Existing IDs, product assignments and the existing sibling-name uniqueness constraint are preserved. The legacy category-create action still creates operational categories without inventing SEO values. Unprepared categories display revision zero until their first managed revision.

The hierarchy is acyclic and at most 12 levels deep. Active descendants require active ancestors. Retiring a category with active products is rejected; move or retire those products first. Parent selection excludes the current category and descendants in the interface, with database enforcement authoritative under concurrency. Existing invalid graphs block migration instead of being silently repaired.

Each edit requires a reason and expected revision. Current state, immutable before/after events, audit and duplicate-request response commit together. Conflicting revisions require reload. The independent global permission catalog.taxonomy.manage is initially assigned only to the owner role; catalog.read is also required. Location-scoped grants do not authorize a global taxonomy edit.

Category mutations serialize with a transaction advisory lock. A narrow SECURITY DEFINER catalog_category_active helper obtains the category share lock used by legacy product creation; the runtime role still cannot directly UPDATE categories. Retirement and concurrent product creation cannot bypass the active-product guard.

## URL ownership

A category URL name uses lowercase ASCII letters, numbers and hyphens, with a maximum of 120 characters. Once assigned it cannot be cleared. Previous names remain permanently reserved for the same category ID; another category cannot take them over. Returning to an old name is allowed for its owner. This stores direct category ownership rather than a chain of redirects.

The preview uses /categories/example. No public category route, HTTP redirect, canonical tag or sitemap is activated by this increment. A future public router must resolve old ownership to the current canonical URL and test permanent redirects before launch. Google documents permanent redirect signals in its [redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).

## Search appearance and product review

Optional search titles (80 characters) and descriptions (320 characters) are application input bounds, not Google limits or ranking guarantees. Plain text is escaped by React; descriptions normalize ordinary tabs and line breaks to spaces. Empty overrides fall back to category/product names and available customer-facing copy. The illustrative preview may differ from actual search results. Google may derive [title links](https://developers.google.com/search/docs/appearance/title-link) and [snippets](https://developers.google.com/search/docs/appearance/snippet) from other page content and truncate by display size.

Product SEO saves through the existing content draft, review, immutable snapshot and audit transaction. A failed audit rolls back SEO as well. Submitted content remains protected from editing. Previous client requests without SEO preserve existing overrides. Empty SEO adds no snapshot keys, preserving previous fingerprints and historical shape. Existing migration-owned content helpers remain private to the definer wrappers.

Category SEO has its own revisions; a search-description change does not rewrite approved product history. A category rename changes the current product projection and requires re-review. Historical content snapshots retain the old category/product facts.

## Private preparation checks

Product content & review displays three checks based on the same consistent read: current content approval, active category/ancestor URL preparation, and product URL preparation. Saving a draft does not satisfy approval. Staff preview includes the search preview. These checks are deliberately preparation checks, not a complete publish policy. No anonymous content API, public photo route, original download or publish button is introduced.

Public-media approval, explicit versioned publication/unpublication, a safe public projection, server-rendered storefront routes/metadata, sitemap, controlled facets, video and the remaining retail phases are still required. No country or sub-brand selector is added.

## Verification and local operations

- Strict types, full API/admin build and 55 database-free/interface checks passed.
- The complete isolated PostgreSQL suite passed 230 reported checks, including 16 presentation checks; a final focused rerun also passed. Coverage includes permissions/CSRF, raw runtime denial, hierarchy/depth/retirement and product-insert races, stale edits, replay ownership, reserved URLs, transactional rollback, review fingerprints and migration upgrade/revert/reapply. Downgrade refuses to discard populated presentation history.
- A schema-17 database backup was restored to a disposable loopback-only PostgreSQL server. All 58 restored table/sequence fingerprints matched. The private archive remains outside Git.
- Development advanced once to schema 18 with all 50 existing data-table fingerprints unchanged. Only the expected schema metadata and one permission/owner grant were added. Repeated migration was a no-op; no sample category or SEO content was inserted in development.
- A disposable test-only staff/browser flow created a parent and child category, changed the child URL while retaining its old reservation, saved product SEO, submitted and explicitly owner-approved content, and verified all three preparation checks. Desktop and 390px phone layouts were inspected without horizontal overflow. Test records, session and generated media were removed afterward.
- Main readiness, /admin and linked JS/CSS returned HTTP 200 after restart. Run npm run presentation:verify-local for aggregate presentation/history/graph checks; it does not print credentials or private content.

No dependency was added for this increment. The existing NestJS/PostgreSQL and React/TypeScript foundations cover the feature. This verification establishes a local development increment, not production readiness or live search indexing.
