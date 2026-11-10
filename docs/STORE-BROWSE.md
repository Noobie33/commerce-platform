# Published product browsing API

Implemented 10 November 2026, schema 21 unchanged. This is a bounded API increment toward the Next.js storefront, not a customer website, a complete search engine or completion of R2/R3. No dependencies, migrations, production fixtures or new staff permissions were added.

## Why this slice

Existing reviewed content already includes a controlled fit choice, free-text material and stock-bearing size/color attributes. Reuse those approved facts rather than introduce competing data. Do not expose free-text material as a normalized fabric filter or infer occasion from descriptions. Managed fabric/occasion vocabularies, category profiles and controlled variant labels still require a separate audited slice.

The customer website is required to use Next.js. NestJS/PostgreSQL remain authoritative; a future Next.js page consumes this public contract rather than staff responses. The current React/Vite admin remains unchanged in this slice. See the [framework decision](RETAIL-ONLY-MASTER-PLAN.md#frontend-framework-decision---10-november-2026).

## Contract

Anonymous GET /api/v1/store/products accepts only the following single-valued query keys. Repeated, unknown, object/array or invalid values return 400 INVALID_STORE_QUERY.

| Key                          | Behavior                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| q                            | Optional literal substring of product name or style code, 1-80 normalized characters; omit for all products. SQL wildcards are literal text.                           |
| category                     | Approved category URL slug; matches that category anywhere in the published ancestor path.                                                                             |
| size, color                  | Optional 1-60-character normalized values for existing SKU attributes with exactly these keys. No guessing that colour, shade or arbitrary custom keys are equivalent. |
| fit                          | Existing clothing-v1 choices: regular, slim, relaxed, oversized, not_applicable.                                                                                       |
| minPriceMinor, maxPriceMinor | Inclusive exact BDT minor-unit integer strings, 0-999999999999; one taka is 100 minor units. No floating-point, fractions, exponents or inverted range.                |
| sort                         | name (default), price_asc or price_desc; price uses the lowest qualifying SKU price. Name then slug break price ties; slug breaks name ties.                           |
| page, pageSize               | Page 1-1000 (default 1); size 12, 24 (default) or 48.                                                                                                                  |

Query values use NFKC normalization, collapsed whitespace and lowercase for matching. Stored data is not rewritten. All user filters are bound SQL parameters; ordering comes only from a fixed allowlist. Requests have a 1,400-byte query-object bound in addition to field limits.

A size/color/price conjunction must match one actual active variant in the eligible publication snapshot. M/Red plus L/Blue does not match M/Blue. A price range cannot borrow a cheaper price from a different size. A product appears once even if several variants qualify.

Each card explicitly allowlists productId, slug, name, styleCode, currency, releaseVersion, matchingVariantCount, matchingPriceMinMinor, matchingPriceMaxMinor and a primary photo (id, alt, width, height, thumbnailUrl). The price range covers qualifying variants, not unrelated variants. It is a published retail catalog price, not a checkout quote or stock promise. Cards do not disclose stock quantities, costs, supplier details, internal notes, original files, image digests, staff identities, content review metadata or a full staff DTO.

The response includes total distinct products, page, pageSize, hasMore, BDT currency and size/color/fit facets. Facets are conjunctive: they describe the complete current filtered result, before pagination, and count distinct products rather than SKU rows. Each facet returns at most 100 values, most frequent first with a value tie-break; truncated=true explicitly signals additional values. Clearing a selected filter is needed to broaden its result. Disjunctive multi-select, counts for category navigation and locale-aware display labels remain later work.

## Privacy, consistency and limits

The existing catalog_release_eligible gate is checked on every listing request; unpublished, stale, changed-price/category, unapproved-content and revoked-photo releases are excluded from cards, totals and facets together. Nothing automatically publishes. Listings use one read-only repeatable-read transaction and a single result query, so cards/counts/facets share a consistent snapshot. A later committed withdrawal is visible on the next request; an in-flight snapshot may finish at its earlier transaction point. No-store response headers preserve the existing withdrawal policy. Future Next.js/server/CDN caching needs an explicit invalidation design before changing this behavior.

Public thumbnail requests still use the existing approved derivative/hash check; listing does not read every image file from disk. Search uses bounded PostgreSQL substring/JSON projection, not an external search service. A transaction-local three-second statement timeout returns 503 STORE_BROWSE_BUSY instead of exposing database errors. Offset/page limits and the timeout bound an individual request, not total hostile traffic. Before public deployment, realistic catalog/load budgets, rate limits, monitoring, query plans/index strategy and any search projection/cache must be reviewed. This implementation is not a production scale claim.

## Verification

Database-free tests cover Unicode/case/whitespace matching input, exact money, forbidden/duplicate/unbounded fields and strict query policy. The existing real-HTTP publication fixture now has M/Red and L/Blue SKUs with different prices. It covers same-SKU combinations, exact inclusive range, category/fit and literal search, distinct facets, privacy/no-cookie/no-store, multiple real products in all sort orders, pagination, invalid anonymous requests and exclusion after publication/price/category/media changes. Test-only products/photos/history/sessions are cleaned after the fixture. Existing publication/migration tests remain active.

No visual admin controls or customer pages were added. Website UI, URL filter controls, accessible loading/error/empty states, proper vocabularies, video processing, availability eligibility, checkout and order flows retain their own acceptance gates. Current operational data is unchanged.

## Schema 22 extension

[Guided product profiles](GUIDED-PRODUCT-SPECIFICATIONS.md) now provide materialGroup and occasion query keys and facets. The groups use canonical versioned codes; they never infer a value from free-text material/composition. Legacy v1 products remain publishable but do not enter these new facets without explicit preparation. Other scope/limits above remain in force.
