# Product details and quick view - 11 November 2026

## Reference and delivered scope

The owner requested close visual and interaction fidelity to Aarong. Direct browser inspection of [the supplied collection](https://www.aarong.com/bgd/brands/taaga-man/panjabis) and [a linked product](https://www.aarong.com/bgd/off-white-striped-taaga-man-panjabi-31eo262006014.html) showed a centered white quick-view panel with imagery at the left, name/price and View Details at the right; the full page uses a sans-serif product title, product code and collapsible product information. No brand assets or product copy are imported.

Our collection and home cards now have a keyboard-accessible quick-view trigger, visible on hover/focus and directly available on touch layouts. One shared native dialog serves the page, with a dynamically loaded product experience rather than a full dialog duplicated for every card. It shows the actual published product, current variant prices and the existing mixed gallery. View Details carries the chosen colour/size into the full product page. Full details now use matching sans-serif typography, product-code/SKU rows and separate description and care/specification accordions.

## Public boundary and lifecycle

GET /product-preview/:slug uses the existing public-product reader and allowlist parser. It returns only the safe frontend projection, with same-origin media URLs and no-store on success, unavailable and failure responses. Query strings, unpublished/missing products and invalid slug paths fail safely. Incoming cookies and authorization are not forwarded to the API. There is no database access from Next.js, new schema, seed or business-record rewrite.

Each open performs a fresh read. Closing or navigating aborts the browser request, clears its data and unmounts playback; a request sequence guard ignores stale completions. Escape/backdrop/close-button dismissal uses native focus containment and restores the trigger. Foreground/online revalidation retains supported size/colour choices. Media failure removes the displayed experience; a deliberate retry rechecks current eligibility. A publication withdrawn while the panel is open cannot serve new media requests, and retry reports unavailable. Already received browser bytes cannot be recalled.

Initial selections are restricted to real colour/size values forming one existing SKU combination; unrelated URL filters and impossible combinations are discarded. Manual selection uses the same existing variant truth and preserves exact integer prices. No stock availability, quantity/cart, wishlist, store-location promise or review is invented. Quick view is read-only, like the current storefront.

## Validation and remaining work

Strict checking, full production builds, 84 database-free tests and 39 focused actual PostgreSQL/publication/Next.js endpoint checks pass locally. The new endpoint check verifies an exact field allowlist, no private hashes, same-origin media, cookie/authorization isolation, rejected arbitrary queries and current withdrawal. Exact-commit GitHub CI remains the complete regression gate.

Browser QA used only disposable generated merchandise in the test database: two real SKU prices, variant-scoped video, selection handoff to the full page, description/care toggles, keyboard access, mobile dialog bounds and real 432 x 768 playback without autoplay. Escape removed all dialog video elements and returned focus. Removing the test publication caused media failure followed by an unavailable retry with no retained dialog images/video. Test fixtures and preview servers are removed after verification.

The complete reference is not finished: image zoom, public approved size guides, real reviews, related-product merchandising, saved products/accounts, cart/checkout, shipping/payment and production operations retain their own acceptance work. Existing originals and 3:4 listing/native-detail ratio decisions remain unchanged. See [reference alignment](REFERENCE-UI-ALIGNMENT.md).
