# Guided material groups and occasions

Schema 22, 10 November 2026. Three new versioned content profiles (clothing-v2, accessories-v2, lifestyle-v2) add a required materialGroup choice and optional occasion choice to the existing description/specification/review workflow. This is a bounded vocabulary release, not a configurable taxonomy administration screen or completion of the storefront.

## Staff workflow

Open Catalog, select a product, then Product content & review. New drafts default to Clothing - guided fields (v2). Choose the appropriate guided product type, select the material group, enter exact material/composition details and care instructions, and optionally select an occasion. Save incomplete drafts; missing required groups block submission. Existing preparer/reviewer permissions, revision checks, duplicate-request handling, owner self-review reasons and publication gates remain in force.

Material group is a discovery classification, not a calculated percentage, certification, manufacturing bill of materials or replacement for exact composition. Staff must verify it against the actual product. Cotton and cotton_blend are different deliberate choices. Mixed and other avoid inventing unsupported classifications; do not infer group from free-text descriptions. Occasion is one optional primary merchandising classification, not an automatically inferred or multi-select tag.

Clothing has textile groups; Accessories and Lifestyle also allow appropriate non-textile choices such as leather, wood, metal and ceramic. Wearables support everyday/work/festive/formal/active/lounge/other; Lifestyle supports everyday/festive/gifting/other. The authoritative codes are versioned in src/database/catalog-vocabularies-v1.ts. They are neutral brand defaults, not a claim about Aarong's private product taxonomy. Adding or changing their meanings requires a new versioned profile/migration with review of historic and public behavior.

Current legacy v1 records keep their profile and exact stored values; the migration never maps Cotton or 100% cotton automatically. Legacy profiles remain available and are labeled in the staff selector. Changing product type currently asks before clearing specification fields; save/review the verified replacement deliberately. Existing v1 products can still publish under their original gates, but have no materialGroup/occasion facet unless explicitly re-prepared with guided fields. Future restrictions on legacy use would need a separate compatibility decision.

## Public browse contract

GET /api/v1/store/products now accepts materialGroup and occasion single-valued canonical codes, with the existing strict query bounds and normalization. They combine with category, size, color, fit and exact price ranges. New facets return distinct-product counts under the same conjunctive filtering/pagination/privacy rules as [published browsing](STORE-BROWSE.md). Composition text is not a facet alias. Selecting an unmatched or absent group gives no matching product; invalid codes return 400.

Only eligible approved publication snapshots participate. Changing a group/occasion in a draft immediately makes the prior release ineligible on subsequent requests; review followed by explicit publication is required to make the new copy public. Existing SKU IDs/options/prices, stock, finance and original photographs are unchanged. No store UI or video upload is added by this release.

## Migration and safety

The migration adds three metadata rows without editing released v1 definitions, existing content, audit/history, public snapshots or permissions. Runtime cannot edit profile metadata. Existing SQL content validation enforces the selected profile's choice values and required submission fields, even if HTTP validation is bypassed. Content audit, concurrency and transactional behavior are reused rather than duplicated.

Downgrade refuses removal if a v2 profile appears in current content or retained content history, including after an explicit return to a v1 draft. An empty unused metadata upgrade can revert/reapply. Operational content verification now compares the three guided definitions against their immutable source and reports profileDefinitionMismatches without exposing product/staff data.

Verification covers legacy metadata/history preservation, incomplete draft/submission, rejected arbitrary/inapplicable group/occasion values over HTTP and SQL, real review and publication, facet separation from legacy Cotton text, filtering and immutable public release behavior, and compiled migration upgrade/down/reapply. The full existing test suite remains required. Desktop/mobile browser acceptance and the local restore/cutover evidence are recorded at completion.

## Technology decision

The owner clarified that keeping the current NestJS backend plus React/Vite staff UI is preferred when it serves the actual workflows well; there is no scheduled blanket migration. Customer pages must use Next.js. Consider an admin framework change only for a concrete, measured need with parity and rollback gates. Aarong governs the requested public experience; its private ERP/framework choices are not assumed or asserted.

## Remaining work

Owner-managed vocabulary lifecycle/aliases, category-to-profile assignment, normalized SKU size/color labels, multi-valued occasions, editorial filter labels/translations and public Next.js controls are future slices. Product video processing and its publication/accessibility/storage limits remain separate. No new package or paid service is required for this increment.

## Local completion evidence

Strict checks, build, 67 database-free/interface tests and all 282 PostgreSQL checks passed. Browser QA used an isolated localhost:4001 test-only session and fictional product: missing group saved as draft with submission disabled; a verified group plus exact composition and occasion saved, submitted and approved. At 390px, document and dialog widths were 390px and all 15 fields fit without horizontal overflow. Desktop and mobile field screenshots were saved; viewport and temporary tab were restored/closed. Approval did not publish the product.

Before development cutover, the schema-21 backup was restored in an isolated loopback server and all 75 table/sequence fingerprints matched. Schema 22 applied exactly once, repeat was a no-op, and all 66 pre-existing non-metadata data tables, legacy v1 profile definitions and permission metadata matched before/after. Existing business records were not seeded or rewritten. Local readiness, admin and new-filter browse smoke checks returned 200. Production encrypted/off-machine backup, load and security launch gates remain separate.
