# Retail-only master plan

Decision date: 9 November 2026, Asia/Dhaka. Status: approved business direction; R1 retail-only policy and R2a typed content/review are implemented (current schema 25; see dated checkpoints for subsequent catalog and staff access increments). See [retail cutover](RETAIL-CUTOVER.md) and [product content](PRODUCT-CONTENT.md). Neutral internal name: commerce-platform.

This is the authoritative delivery plan for the owner's single retail fashion/lifestyle brand. It supersedes wholesale/B2B and customer-credit goals in older roadmaps. The original R0 planning change altered documentation only. The subsequent R1 implementation retires trade writes through a forward migration while preserving business history; later phases remain pending.

## 1. Fixed scope

- One owned brand, Bangladesh, BDT. No country/market selector, sub-brand navigation, brand filter or reseller portal. Men, women, kids and lifestyle remain departments; warehouses and shops remain internal locations.
- Retail sales only. No wholesale prices, trade accounts, negotiated B2B quotation workflow, MOQ or quantity pricing tiers. Buying 50 items still uses retail prices unless an explicitly configured retail promotion applies.
- No revolving customer trade credit, credit-limit or payment-terms workflow in the target retail system. COD, pending payment, refunds and supplier credit/payables remain distinct valid concepts.
- Keep purchasing, suppliers, warehouse/store stock, transfers, customer contact/order records, permissions, audit history and operational reporting. POS and manufacturing remain future extensions, not launch promises.
- Follow Aarong's shopping structure and experience, with the owner's identity, products, photography and policies. Retain the earlier Tabaya-inspired requirement for product videos alongside photos. Existing reference feature IDs SF-01 through SF-23 remain in scope unless explicitly excluded above.
- Public retail pricing is centrally controlled. General staff should not negotiate per-order prices. Historical overrides remain historical facts; they must not be silently converted into promotions.

## 2. Evidence and current baseline

Read-only source audit baseline: commit 59e2fed932b25d7c3a24b7c7a9bab472233b5a63, schema 12. The previous validated baseline reports 32 unit/interface checks and 170 PostgreSQL integration checks; these are prior results, not tests rerun by this planning change.

| Area            | Implemented foundation                                                                                                    | Still required                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Staff access    | Login, forced initial password change, sessions, permissions/location scopes, audit; read-only team directory             | Staff/role administration, secure recovery, MFA and operational access review                                            |
| Catalog/media   | Products, categories, stock-bearing variants, private image originals and derivatives                                     | Rich typed attributes, collections, size guides, publication workflow, public projection, video processing               |
| Inventory       | Multi-location ledger, receipts, adjustments, atomic transfers/reversals, stock holds and availability                    | Physical dispatch/in-transit/receipt workflow, quarantine/safety stock policy, firm order allocations and sales dispatch |
| Purchasing      | Suppliers, PO issue/cancel, partial receiving, supplier invoices, recorded payments, allocations/reversals and statements | Supplier returns/credits, opening balances, valuation and complete accounting reconciliation                             |
| Customers/sales | Contact/address records, drafts, snapshots and timed holds                                                                | Retail-only cutover, confirmed orders, fulfillment, retail invoices, payment/refund lifecycle                            |
| Legacy scope    | Retail/wholesale segments and channels, customer credit settings and controlled price overrides exist                     | Schema 13 retires active trade writes; historical contracts remain readable                                              |
| Public website  | Reference contract and UI direction                                                                                       | Customer storefront, account, cart, checkout, gateway/courier integrations and service journeys                          |

The staff interface is React/TypeScript with Vite; backend is NestJS/TypeScript with PostgreSQL. There is no completed public shopping website today. Recorded supplier payments do not transfer money. Immediate inventory transfers do not yet model trucks, goods in transit or receiving confirmation. No production-readiness claim follows from the test count.

## 3. Architecture and why

Keep the current modular NestJS backend and PostgreSQL. Catalog, inventory, procurement, orders and finance share transactional invariants; a modular monolith keeps stock and money updates atomic without introducing distributed transactions. Extract services only for a measured operational need.

Keep the staff React/Vite app. It serves authenticated workflows and does not need replacing to deliver the public visual direction. Use feature-based modules, thin HTTP controllers, transaction-owning services and explicit database migrations as required by [engineering standards](ENGINEERING-STANDARDS.md).

The owner requires a separate Next.js storefront, planned with App Router. This is a confirmed framework decision, not an optional candidate. Server rendering suits discoverable product/category pages, metadata and first-load content; interactive filters/cart/gallery can use client components. Validate the supported stable release, Node/React compatibility and security maintenance when this slice starts; no exact version or dependency installation is authorized by this document alone. The backend remains the authority for prices, authorization, stock and orders; the storefront must not create a second business-rule implementation.

Suggested incremental structure, without moving existing files just for appearance:

```text
apps/admin/                 existing private staff UI
apps/storefront/            future public storefront
src/modules/                feature-owned business services and APIs
src/infrastructure/         persistence/storage/provider adapters
src/database/migrations/    immutable, ordered schema changes
src/scripts/                bounded operational commands
packages/contracts/         only if real shared contracts justify extraction
```

Public DTOs are separate allowlisted contracts, not staff responses with authentication removed. Share stable identifiers and validated contract types where useful. Add durable jobs/outbox processing when media, payment or notifications require retries. Avoid speculative Redis, microservices, Docker requirements or paid cloud services. Retain pinned dependencies/lockfile; reassess supported patches before deployment.

## 4. Business flow

1. Create supplier and PO; receive actual quantities into the warehouse, including partial receipts. Match supplier invoices and record actual payments separately.
2. Send goods to a shop. Until a dispatch/receipt workflow is implemented, the existing transfer is an immediate both-location posting and must be represented honestly. Future transfers move through dispatched, in-transit and received states; discrepancies require a controlled resolution.
3. Employees create product content, variants, photos/video, measurements and care details. A permitted reviewer checks completeness, price and presentation, previews, then publishes. Operationally active stock is not automatically public content.
4. Customers browse departments/collections, filter/search, view photos/video and size guidance, select a real available SKU and add it to cart. Cart content alone does not guarantee stock or freeze price.
5. Checkout recalculates price, offers, delivery charges, address eligibility and stock on the server. Create a bounded temporary hold while the relevant payment/confirmation step occurs.
6. Confirm an eligible prepaid or COD order and atomically convert its hold to a firm allocation. Staff pick/pack; dispatch consumes that order's allocation and records its source-linked stock movement.
7. Track delivery separately from payment settlement. Reconcile gateway receipts or courier COD remittances, fees and differences. Customer returns require receipt/inspection; restock, quarantine, exchange and refund actions have separate traceable effects.

Example: receive 100 black shirts in M/L SKUs, send 20 to a shop and make only approved locations eligible for online fulfillment. An online purchase of two M shirts allocates two available M units; it cannot consume an L unit or another order's allocation. A later return increases sellable stock only after inspection, and refunding money alone does not increase stock.

## 5. Aarong-aligned experience and complete feature coverage

The detailed acceptance register is [STOREFRONT-REFERENCE.md](STOREFRONT-REFERENCE.md). All 23 IDs must eventually have implementation and acceptance evidence. The table below assigns delivery ownership; it does not mark them implemented.

| IDs                 | Target experience                                                                                                        | Primary phase      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| SF-01, SF-02, SF-03 | Single-brand navigation, editorial campaigns/looks, new arrivals, spacious image-led product grids                       | R2-R3              |
| SF-04, SF-05        | Typed size/colour/fabric/fit/price facets, useful search, sorting, URL state and clear no-results recovery               | R2-R3              |
| SF-06               | Quick view, wishlist/save-for-later with explicit guest/account merge rules                                              | R3, R6             |
| SF-07, SF-08        | Accessible zoom/swipe gallery; ordered photos/video with posters, playback controls and optional managed shoppable video | R2-R3, R6          |
| SF-09, SF-10, SF-11 | SKU/code, price, sizes, availability, rich specifications and reusable size guides                                       | R2-R3              |
| SF-12, SF-13        | Related products/curated looks, real shop directory and size-specific availability                                       | R3, R6             |
| SF-14               | Customer registration/sign-in/recovery, profile, addresses, order history/tracking                                       | R5-R6              |
| SF-15, SF-16        | Persistent cart, variant edits, checkout, BD address/delivery/payment and confirmation                                   | R4-R5              |
| SF-17               | Support, order amendments/cancellation, return/exchange/refund journeys                                                  | R4-R6              |
| SF-18, SF-19        | Moderated reviews, genuine rating aggregates, retail offers/coupons, gift options and single-brand loyalty               | R6                 |
| SF-20               | Contact/FAQ, delivery/returns/privacy information, consent-aware newsletter/social links                                 | R3, R6             |
| SF-21, SF-22        | Bangladesh-only behavior, responsive accessible UI, recovery states, media performance and indexing                      | Every public slice |
| SF-23               | Staff editing, review/publication and customer/order operation screens                                                   | R1-R6              |

Design principles: restrained white/neutral surfaces, clear typography, large fashion imagery, consistent spacing, deliberate navigation and uncluttered product detail. Review desktop and mobile compositions against the reference, using original brand assets and properly licensed fonts. Keep the staff UI suitable for operational density and tasks; the public reference does not reveal Aarong's internal ERP.

Reference evidence: Aarong/Taaga's public landing shows campaign groupings, new arrivals and curated looks. The earlier 8 November audit recorded listing/product interactions as described in the reference register. The 9 November automated page extraction cannot independently verify all interactive or account-only states. Authenticated journeys, completed checkout, loyalty economics, stock promises and private processes require further discovery; do not claim exact parity based on a landing page or invent their rules. Tabaya remains the mixed-media reference. These are design/function references, not permission to import their identity, assets or customer content.

## 6. Catalog, publication and media model

Keep product and SKU identities stable because stock and procurement reference them. Model category-specific specifications separately from sellable size/colour variants. Combined filters must match one actual qualifying SKU rather than unrelated values on different variants.

Separate the primary category tree from multi-membership collections, campaign sections and curated looks. Add stable slugs, redirect history, SEO metadata and typed vocabularies. Version size guides with units and garment-versus-body measurement labels; preserve the guide/content snapshot needed for an order dispute.

Add draft/review/preview/publish scheduling and completeness checks. Preview must require authorization. Public queries return only approved publication content, approved retail prices and safe availability; never supplier costs, staff notes, customer details, draft media, originals or unrestricted internal quantities.

Preserve original uploaded files unchanged and checksummed for permitted staff download. Serve separately generated, appropriately sized public derivatives. Define configurable validated limits from measured workloads; do not treat eight images or 5 MB as a permanent business limit. Original resolution remains intact; display derivatives may intentionally be smaller. Originals still consume storage and require backup.

Video needs its own actual file/container/codec/duration validation, processing limits, ordered media records, variant links, posters and ready/failed states. Upload does not imply publication. Playback must have accessible controls, avoid sound autoplay, pause inactive videos and respect reduced-motion/data-saving preferences. Hosted storage, CDN, processing and backup expenses must be reviewed before selecting paid services; pgAdmin is database administration, not an image/video hosting service.

## 7. Safe retail-only cutover

This is the completed R1 implementation checklist, retained for future upgrades and review. See [actual cutover behavior](RETAIL-CUTOVER.md). Hiding dropdowns alone is insufficient.

1. Re-read this plan and inspect current data read-only: customer segments/credit settings, sales channels, overrides, live holds, stock and financial balances. Do not rely on the earlier empty-development-data observation. Prepare a verified backup and isolated restoration before a consequential data migration.
2. Inventory customer segment and credit fields across validation, controller/service contracts, staff forms/detail/filter screens, SQL functions and permission definitions. Preserve normal contact/address/history and optional business billing identity; a company name does not confer wholesale privileges.
3. Change sales draft validation, UI and SQL compatibility rules to retail-only. Retire customer trade credit writes and general negotiated pricing. Legacy functions and direct database write paths must reject prohibited behavior too.
4. Update reservation SQL as well as draft SQL: schema 12 reservation posting still checks customer segment against sales channel. Keep all current authorization, stock protection, order/hold revision, lock ordering and retry guarantees intact.
5. Distinguish order source (online/store/staff) from the obsolete retail/wholesale channel distinction. Do not lose future source reporting by treating them as the same field.
6. Use forward migration 13 or later; do not edit applied migrations 1-12, reset the database or silently delete wholesale, override or credit history. Classify real incompatible records before choosing a mapping. Existing financial totals, price snapshots, SKU IDs, ledger entries and audit facts must remain unchanged.
7. Define compatibility for old clients and idempotent replays. A temporary adapter may accept a legacy retail channel; it must reject new wholesale/credit writes. Replays must retain authorization checks and must not create new prohibited side effects. Archive historical fields under protected access before considering any later destructive cleanup.
8. Test isolated fresh and upgraded databases, representative legacy records, active reservations, retail workflow, permission changes and forbidden direct SQL writes. Reconcile inventory/financial totals and review the staff UI before merging.

No commitment to deleting columns is made now. The owner must see an explicit data-impact report if actual historical records need a business decision. Supplier payables remain operationally valid throughout this cutover.

## 8. Stock, order and payment invariants

Temporary draft holds and confirmed-order allocations are different lifecycles. Existing holds expire within at most 24 hours and are not a suitable long-lived COD allocation. Convert a valid hold to an allocation atomically without counting it twice. An expired hold does not entitle a late payment to unavailable stock.

Define eligible fulfillment locations, safety stock, damaged/quarantined goods and in-transit treatment before offering availability. Public availability is derived from eligible stock after valid holds, firm allocations and applicable exclusions; do not add every internal location indiscriminately or double-subtract a hold/allocation. Choose and persist the fulfillment location or an explicitly supported split policy at order acceptance.

Confirmation freezes accepted product/price/offer/delivery-policy snapshots and exact totals. Dispatch consumes its own allocation and posts a source-linked sale movement in the same protected transaction, while retaining other orders' protection. No generic inventory adjustment may masquerade as a sale. Cancellation before dispatch releases commitments; post-dispatch returns require a receipt and inspection, with only sellable units restocked.

Keep separate state machines for order acceptance/cancellation, fulfillment, payment and refund. COD may be confirmed while unpaid. Delivery status does not mean a courier has remitted money. Gateway success is trusted only after server-side signature/provider verification, matching order/currency/amount and replay-safe processing. Persist durable provider event identifiers and retryable notification work.

Handle payment failure, duplicate/out-of-order callbacks, late success after expiry, unavailable stock, partial refund, failed refund, cancellation/payment races and courier return-to-origin explicitly. Never fabricate successful refunds or oversell to resolve an exception. Reconcile actual receipts, fees, settlements and remittance differences; finance approval resolves exceptions with an audit trail.

Invoice numbering, tax treatment, revenue recognition, discounts, delivery charges and valuation require explicit business/accounting policy before posting. Reference-site visuals cannot establish those rules. Full general ledger and accounting exports require reconciliation gates, not just a report labelled accounting.

## 9. Access and operational responsibility

Separate content preparation from publishing/price approval. Warehouse and fulfillment staff need location-scoped actions; finance controls recorded receipts, settlements and refund approval. Customer support gets only necessary customer/order information. The owner retains controlled emergency administration, without sharing an owner password for routine work.

Staff roles/access and onboarding are implemented in schemas 20-21. Recovery and MFA remain pending features. Test revocation, default-deny behavior, location boundaries, duplicate requests and audit completeness when adding them. Public customer sessions are separate from staff sessions. Include abuse limits, safe account recovery, consent and retention/access/deletion policy for personal data.

## 10. Delivery phases and gates

Phases are dependency-driven, not calendar promises. Each implementation PR must identify a bounded slice, its acceptance cases and the updated SF status; a partially built phase is not a completed launch.

| Phase                        | Deliverable                                                                                                                              | Exit gate                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R0 - current planning        | Retail-only scope, audited dependencies and authoritative roadmap                                                                        | Decision recorded; old plans point here; no business data changed                                                                             |
| R1 - retail cutover          | Remove active wholesale/trade-credit/negotiated B2B behavior across staff, API and SQL; preserve history                                 | Fresh/upgrade migration tests, forbidden-write tests, baseline regression, active-hold compatibility and reconciled data-impact report        |
| R2 - publishable catalog     | Staff access administration needed for operations, typed specs/collections/size guides, media/video and controlled publication           | Permission separation, original integrity, safe media processing, draft privacy and publish completeness tested                               |
| R3 - public experience       | Aarong-aligned home, navigation, listing/search/filter, detail, gallery, shop/service templates using real published data                | Mobile/desktop visual review, accessible controls, safe public DTOs, correct SKU facets, crawlable pages; no premature working-checkout claim |
| R4 - retail order core       | Confirmed orders, firm allocations, pick/pack/dispatch, invoice and manual receipt/cancellation/return/refund controls                   | Last-unit concurrency, exact money, source-linked ledger, reversal rules and end-to-end staff pilot pass                                      |
| R5 - online transaction      | Cart/checkout, account or agreed guest flow, gateway/COD/courier integration and notifications                                           | Sandbox callbacks/retries/expiry races, delivery/fee rules, settlement reconciliation and end-to-end test purchases pass                      |
| R6 - complete customer scope | Wishlist/quick view completion, account history/tracking, reviews, loyalty/offers/gift options, returns/support and editorial completion | SF-01 through SF-23 each has acceptance evidence or an explicit owner-approved policy/deferment; no quiet feature loss                        |
| R7 - production pilot        | Accounting/stock reconciliation, security, backup recovery, monitoring, deployment and trained staff pilot                               | Restore drill, recovery targets, access review, production configuration, realistic load/accessibility checks and business sign-off           |

Returns/refunds and settlement correctness are required before real online orders; R6 adds complete customer self-service presentation rather than deferring essential financial controls. More advanced accounting, POS/hardware, manufacturing and additional warehouses remain separately scoped extensions; they cannot compromise stock truth in the launch system.

## 11. Required verification

- Preserve the existing relevant regression suite and add tests for the changed behavior. Planning-only edits do not warrant rerunning the whole runtime suite; functional changes require type/build/unit checks and isolated PostgreSQL/migration checks where applicable.
- Retail cutover: legacy data upgrade, prohibited wholesale/credit calls at API and SQL, unchanged historical amounts/stock, active hold/replay compatibility and scoped authorization.
- Inventory/orders: simultaneous last-unit purchases across channels/locations, expiry and confirmation races, allocation conversion/dispatch, cancellation, partial return and retry without duplicate stock or money.
- Payments: provider verification, wrong amount/currency/order, duplicate/out-of-order/late callbacks, cancellation races, COD remittance shortfall/fees and refund failure/retry reconciliation.
- Catalog/media: combined facets match actual SKUs, unpublished/private data and path guessing remain protected, original-file checksums survive processing, failed videos cannot publish.
- Experience: representative 360/390/768/1024/1440-width screens, keyboard focus/contrast, zoom/video controls, slow network/error recovery and measured mobile performance. Set and record launch budgets before acceptance; do not substitute a desktop screenshot for mobile usability.
- Operations: realistic staff walkthrough from receiving to return; audit and stock/payment reconciliation; encrypted backup with tested restore; deployment/migration rollback or roll-forward rehearsal without rewriting posted history; actionable monitoring and incident ownership.

## 12. Decisions needed later, without blocking today's planning

Already fixed: retail-only, single brand, Bangladesh/BDT, no country/sub-brand controls, private originals, mixed product media and an Aarong-aligned customer experience.

Collect business inputs at the phase where they become necessary: final brand/assets, business invoice identity, shop addresses and fulfillment eligibility, delivery areas/charges/COD rules, return/exchange windows and exclusions, tax/accounting treatment, gateway/courier contracts, marketing/loyalty rules and customer-content moderation. Recommend simple defaults for review; do not invent policies or copy Aarong's unseen terms. Guest checkout is a candidate UX decision to settle before R5.

Local development currently uses existing tools. Hosting/domain, public storage/CDN, backup, messaging, payment/courier fees and POS hardware can introduce costs; prepare concrete choices before any paid commitment. Credentials stay local, never in chat, code or Git.

## 13. Next-session checkpoint

R1 and R2a are implemented; schema 16 adds authenticated live updates (see [data freshness](DATA-FRESHNESS.md)), and schema 17 adds [versioned size guides and collections](SIZE-GUIDES-AND-COLLECTIONS.md). Continue with category vocabulary/SEO and the remaining staff-role/public-media publication gates. Typed product profiles, private previews and content review already exist; do not rebuild them. Review current code/data first. Do not resume the old customer-credit or B2B confirmation roadmap. Keep current operational history intact. Update this plan and the feature register after each accepted slice, and distinguish implemented behavior, tested evidence and remaining gaps.

## Sources

- [Aarong/Taaga public reference](https://www.aarong.com/bgd/brands/taaga), checked 9 November 2026; public page extraction only for this pass.
- [Tabaya mixed-media reference](https://tabaya.com/), retained owner requirement and earlier observations; no assertion of private implementation.
- [Next.js server/client component documentation](https://nextjs.org/docs/app/getting-started/server-and-client-components), checked 9 November 2026; architecture rationale, not a pinned-version selection.
- [Detailed reference evidence and SF-01-SF-23 contract](STOREFRONT-REFERENCE.md), including earlier observation limits.

## Schema 18 checkpoint - 10 November 2026

R2 remains in progress. [Category hierarchy, category/product SEO and private preparation checks](CATEGORY-SEO-AND-PREPARATION.md) now complement content review and schema-17 guides/collections. Category IDs and existing operational records are preserved; URL ownership is retained across renames. Verification: 55 database-free/interface plus 230 PostgreSQL checks, restore-verified backup, unchanged fingerprints of 50 existing development data tables, and disposable desktop/390px browser checks. No public route or publication action is enabled.

The next bounded slice is public-media approval and explicit versioned publication with safe public projection and revocation gates. Staff/role administration, controlled attribute vocabularies/facets, video, and the remaining R2 acceptance work are still pending; the R3 storefront and transaction phases retain their existing gates.

## Schema 19 checkpoint - 10 November 2026

R2 remains in progress. [Explicit media approval, alternative text, versioned publication/withdrawal and safe public reads](WEBSITE-PUBLICATION.md) now complement content review and category preparation. Original media, drafts and private operational fields remain protected. No existing product is automatically published and no customer storefront or checkout is deployed. Current-release eligibility is checked on each anonymous product/image request; changed data or revoked approval suppresses the old release.

Remaining R2 work includes staff/access administration, controlled attributes/facets, mixed video and the remaining launch media/operational gates. R3 can now consume released product DTOs, but Aarong-aligned navigation/listing/detail templates, search indexing and customer functionality retain their separate acceptance gates.

## Schema 20 checkpoint - 10 November 2026

R2 remains in progress. [Owner-controlled roles, existing staff status and location assignments](STAFF-ACCESS-ADMINISTRATION.md) are now implemented with versioned history, protected owner access, explicit scope policies and transactional session revocation. Existing credentials and role grants are unchanged by the migration. No real employee account is created automatically.

The next bounded identity slice is secure employee onboarding and first-login activation. Invitation/credential delivery, password recovery, MFA/recent reauthentication and owner-transfer controls retain their launch gates. Controlled attributes/facets, mixed video and the public storefront/transaction phases remain on the roadmap.

## Schema 21 checkpoint - 10 November 2026

[Owner-created employee onboarding and personal first activation](EMPLOYEE-ONBOARDING.md) are implemented with owner password confirmation, single-use expiring codes, private history, rate limits, no shared initial password and no automatic business roles. Existing access editing remains separate and deactivation revokes pending codes atomically. No real employee account is seeded by the upgrade.

R2 still needs controlled attribute/facet and mixed-media/video work. Recovery, MFA/step-up policy, owner transfer and production delivery/abuse/monitoring controls remain launch gates. Customer storefront templates, search indexing, retail order/fulfillment and online transactions retain their phased acceptance criteria.

## Frontend framework decision - 10 November 2026

The owner requires Next.js for the customer website after the current software work. Latest clarification: keep the NestJS backend and React/Vite staff frontend where they meet measured needs; the earlier blanket future admin migration request is superseded. No automatic migration is scheduled. A later framework change needs a concrete benefit, functional parity, preserved authentication/CSRF/live updates, measured performance and a rollback path. NestJS/PostgreSQL remain the business authority. Next.js uses React; a framework change alone is not evidence of better performance.

Use the storefront phase to install project-local, pinned Next.js/React dependencies with TypeScript and the necessary quality checks. Do not install Next.js globally or add it to the existing staff app now. Recheck supported stable releases, security fixes, Node/npm/React/TypeScript compatibility and deployment requirements at that time. The PC currently reports Node v24.16.0 and npm 11.13.0; this observation is not a future compatibility guarantee. No new runtime, database, Docker, paid hosting or cloud account is required by this decision alone.

Next.js rendering, metadata and image delivery should support the Aarong-aligned public experience; interactive filters/gallery/cart remain deliberately scoped client components. Public caching must respect publication withdrawal and must never become the authority for stock, price, authorization or orders. Staff/customer sessions and private/public contracts remain separate.

Installation reference: [official Next.js installation documentation](https://nextjs.org/docs/app/getting-started/installation), checked 10 November 2026. No dependencies or runtime behavior changed for this planning update.

## Published catalog browse checkpoint - 10 November 2026

The [read-only published-product browse API](STORE-BROWSE.md) now supports literal name/style search, category-path filtering, existing size/color and controlled fit filters, exact price ranges, stable sorting, pagination and distinct-product facets. Size/color/price must match one real SKU. Public cards, counts and facets all use the existing eligibility gate; no staff data, stock quantities or drafts are exposed. Schema remains 21; no existing records were rewritten.

This advances the R3 API foundation without starting the Next.js UI or declaring R2 complete. Managed material/occasion vocabularies and category profiles, controlled SKU labels, mixed media/video, storefront pages and production search/load/abuse controls remain pending.

## Schema 22 checkpoint - guided specifications

[Versioned guided material groups and primary occasions](GUIDED-PRODUCT-SPECIFICATIONS.md) are now implemented with staff dropdowns, legacy history preservation, SQL-enforced choices and approved-publication browse facets. This is a migration-owned initial vocabulary, not an owner-editable dictionary. Category/profile assignment, normalized SKU labels, mixed-media/video and Next.js storefront controls remain pending. The latest owner clarification keeps NestJS + React/Vite for current staff workflows and requires Next.js for public customer pages; no blanket admin migration is scheduled.

## Video preparation checkpoint - 10 November 2026

The [private video preparation engine](PRODUCT-VIDEO-PIPELINE.md) now has explicit local tools, actual MP4/MOV inspection, bounded conversion, original integrity, sanitized playback/poster and private handoff artifacts. Schema stays 22; no browser upload, staff video screen, durable processing queue, catalog video mutation or public playback is enabled. V2 intake/worker/metadata/UI and V3 reviewed mixed-media publication retain separate gates. This checkpoint does not complete video support or the Next.js storefront.

## Schema 23 checkpoint - private video intake

[Product video intake and private review](PRODUCT-VIDEO-INTAKE.md) add authenticated streaming upload, separate restricted background worker, durable fenced job states, variant/order metadata, retained original download, private range playback, reasoned review and history. The feature is explicitly loopback development-only and production intake is disabled. No existing product/content/photo release or stock/finance records are rewritten. Mixed photo/video public publication, captions/accessibility and Next.js gallery remain separate acceptance work.

## 10 November 2026: private mixed-media gallery preparation

Schema 24 adds a versioned photo/video gallery draft, private preview, keyboard-accessible ordering, descriptive/review/accessibility checks and retained editorial history. It preserves current product/public release data and adds no public video route. See [gallery draft contract](PRODUCT-GALLERY-DRAFTS.md). Explicit mixed-media publication and the Next.js customer gallery remain the next delivery boundary.

## 11 November 2026: explicit mixed-media publication

Schema 25 binds a separately reviewed photo/video order to an explicit product release. Native dimensions and ratios are retained in the public projection; derivative playback/posters use product/release-scoped links and current approval checks. Editing only a draft preserves the existing release, while selected-media changes or consent withdrawal close access. Initial public clips are silent; captions/audio accessibility and the actual Next.js customer pages remain pending. See [mixed gallery publication](MIXED-GALLERY-PUBLICATION.md).
