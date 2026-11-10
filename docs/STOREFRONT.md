# Local Next.js customer storefront

## Delivered boundary - 11 November 2026

The customer application is apps/storefront, separate from the React/Vite staff workspace and NestJS API. It provides an editorial home, eligible-category navigation, searchable collection, same-SKU size/colour/price filters, controlled specification facets, stable sorting/pagination and product pages with actual variants and an ordered photo/video gallery. Only explicitly published and currently eligible releases appear. An empty catalog has an honest empty state, not fictional merchandise.

This is a read-only local preview. Customer accounts, cart, checkout, delivery promises, payments, confirmed orders, fulfillment, returns and deployment remain pending. No stock availability, reviews, promotions or purchasing controls are invented. Your brand is a neutral configurable placeholder. Bangladesh/BDT and one brand are fixed; there is no wholesale portal, brand switcher or country picker.

## Why this foundation

Next.js 16.4.6 is pinned to the supported 16.x Active LTS line with the November security fixes; existing React/ReactDOM 19.3.1 and Node 24.16.0 are retained. Next.js is installed locally as a workspace dependency, not globally. The staff application remains React/Vite because moving its established workflows would not establish a measured performance improvement.

Sources checked 11 November 2026: [Next.js support policy](https://nextjs.org/support-policy), [November security release](https://nextjs.org/blog/november-2026-security-release), [TypeScript support](https://nextjs.org/docs/app/api-reference/config/typescript). The [reference register](STOREFRONT-REFERENCE.md) remains the broader Aarong-inspired requirement contract; this slice does not complete it. No reference-brand assets are copied.

Server-rendered pages supply product metadata, canonical links and safely escaped structured data without relying on client-side catalog downloads. Pages and public API reads use no-store; React memoization only shares reads within a render request. Product withdrawal returns HTTP 404. Local previews have noindex metadata and disallow-all robots until a separate deployment/SEO gate.

## Public boundary

The Next.js process receives only allowed operating-system variables and public STORE_ settings. Database, staff session and GitHub credentials are not passed to it. Runtime payload parsers allowlist fields and bound content. Money stays integer minor units and uses BigInt formatting.

GET /api/v1/store/navigation derives categories only from eligible published releases in a read-only consistent snapshot. Existing schema 25 is retained; there is no database migration or rewrite in this increment.

The same-origin /media proxy accepts only exact public photo or product/release-scoped playback/poster paths. It never forwards browser cookies or authorization, never proxies staff/original/arbitrary URLs, and bounds response size, content type, timeout and single byte ranges. No-store is preserved and Next image optimization is disabled so it cannot retain a withdrawn derivative in an independent optimizer cache. Eligibility is checked by the API for each request. Already received browser bytes cannot be recalled. Public video remains explicitly local-development-only, silent, and separately rights-reviewed.

## Media and interaction

Product cards have a consistent 4:5 frame with contain, so imagery is not cropped. Product details use recorded native dimensions: 9:16 portrait, square and landscape retain their ratios within a viewport-height cap. Uploaded originals are unchanged; existing separate display derivatives remain in use. Video starts only on request, uses a poster, and pauses when inactive, offscreen or the page is hidden. Keyboard gallery navigation and native playback controls are provided. Audio/caption accessibility remains a future gate.

Search/filter forms use GET URLs with progressive Next.js navigation. Invalid queries fail safely, filters match one real SKU and product links preserve selected size/colour. Foreground/online events refresh the read-only server view; no staff live-event stream or recurring background polling is exposed to customers.

## Local operation

After npm run build, npm run start:local starts the API on http://127.0.0.1:4000, the staff UI at /admin, the restricted video worker when configured, and the Next.js preview on http://127.0.0.1:3000. Stopping the coordinator or API stops its owned storefront and worker. npm run store:local runs the customer preview separately when needed. No paid hosting is configured.

Optional root .env.storefront accepts only STORE_API_ORIGIN, STORE_SITE_ORIGIN and STORE_BRAND_NAME. Defaults work without this file. Origins currently accept loopback HTTP only. Do not copy the API environment into the storefront. Production domains/TLS, security headers including CSP, storage/CDN, load budgets, monitoring and recovery require separate deployment acceptance.

## Validation

Strict type checking and optimized production builds pass. Six new unit cases cover exact-money queries, DTO field stripping, native ratios, public process environment and safe structured-data escaping. Production Next.js integration tests run against the actual isolated PostgreSQL-backed API: SSR and metadata, filters, private-route denial, cookie/authorization isolation, byte-range playback and withdrawn product/media 404s. The full PostgreSQL suite reports 328 passing checks; database-free checks report 83. Real-codec coverage remains 14 checks. Screenshots and disposable fixtures are local-only evidence, never merchandise seeded into the business database.
