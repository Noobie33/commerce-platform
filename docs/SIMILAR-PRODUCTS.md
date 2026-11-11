# Published similar products - 11 November 2026

## Delivered behavior

Full product pages now include a reference-style Similar Products rail only when other eligible products exist. Desktop shows four cards, intermediate widths three and narrow layouts two, with horizontal scroll, keyboard access and previous/next controls. Existing quick view, real prices and full-details links work on these cards. The current product is excluded; no empty recommendations, fictional popularity, stock promise or cross-category fallback is shown. This advances the [Aarong reference](STOREFRONT-REFERENCE.md), not the entire remaining storefront contract.

## Selection and publication boundary

GET /api/v1/store/products/:slug/related is an explicit public read-only route. It requires a currently eligible published source and selects only eligible published candidates sharing the exact final category ID. It returns at most eight existing public card projections, never source descriptions, supplier/stock/financial fields, media hashes or internal ranking scores. Arbitrary query parameters are rejected. The existing no-store policy applies.

Ranking is deterministic and auditable: shared nonempty controlled material group adds three points, occasion two, fit one; then closer lowest retail price, name and URL name break ties. Prices remain integer minor units. Source and candidates are evaluated in one repeatable-read, read-only transaction with a three-second statement timeout. Source lookup uses the existing release URL index; candidate category filtering precedes candidate eligibility/ranking. This introduces no migration, new grants, paid recommendation service or behavioral tracking. Schema remains 25.

The server-rendered optional rail uses the same allowlisted card parser as browse. It streams separately from the main product details and disappears on recommendation errors, rather than hiding valid core product information. No persistent recommendation cache is introduced. Source withdrawal returns 404 for this endpoint; candidate withdrawal is excluded on the next read. Already received browser content cannot be recalled.

## Validation

Strict checks, production builds, 86 database-free cases and 44 focused PostgreSQL/publication/Next.js cases pass. New cases cover empty results, invalid/unpublished source, unknown query rejection, self exclusion, deterministic order, public card allowlisting, actual server-rendered recommendations and candidate withdrawal followed by a fresh read. Exact-commit GitHub CI remains the full regression gate.

Browser QA used generated test-only merchandise: six published same-category items, one genuinely published separate-category item and a hidden draft. Only the six same-category peers were returned in the expected order. Desktop start/end controls and zero-scroll return, quick view with the correct product/price, mobile keyboard/button movement and two-card layout were exercised. At a 390px viewport the page stayed within 375px while the rail scrolled independently; one Next action moved the rail to 339px. A scroll-padding edge-state issue was fixed before acceptance, and unchanged edge state no longer rerenders controls on every scroll event. All generated products, library/chart history, category records, media and preview servers are removed after verification.

No production-scale load or recommendation conversion claim is made. Large-catalog query/index budgets remain deployment acceptance work. Related products use publication eligibility and do not establish online stock availability; confirmed checkout/fulfillment and customer account/wishlist remain separate slices.
