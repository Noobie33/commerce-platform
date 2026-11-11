# Guest wishlist - 11 November 2026

## Delivered scope and reason

Product cards, full details and quick view share a heart control. The header links to /wishlist with the saved-product count. The list supports removal, empty/loading/error states and unpublished products. This advances the reference wishlist requirement without inventing customer authentication before the account slice is ready. It saves products, not selected variants or a cart, and makes no stock reservation.

Only versioned stable product IDs are stored under commerce.store.saved.v1 in this browser. Names, prices, images, customer details and staff credentials are never persisted in this list. The limit is 50 products, newest first. It is a deliberate bounded guest-list limit and can be revised with evidence; it is not a catalog or media limit. Clearing browser data removes the list. Account sign-in, cross-device synchronization and account merging remain pending and the page states this explicitly.

## Persistence and concurrency

The codec rejects malformed, duplicate, oversized, unsupported-version or extra-field records. Save/remove expresses the desired state, so repeating an action does not invert it. A per-tab queue plus same-origin exclusive Web Locks coordinates read/modify/write across supporting tabs; storage events read the latest record rather than trusting potentially stale event values. Lock waits are bounded to three seconds. Browsers without Web Locks use best-effort synchronous read/modify/write and cannot guarantee simultaneous-tab writes. See the [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).

Actual blocked, corrupt or unwritable storage switches to visit-only memory with a visible notice. Corrupt or unsupported persisted records are not silently overwritten. This is not a durable account store. No analytics, third-party service, database migration or new dependency is introduced; schema remains 25.

## Fresh public data boundary

POST /api/v1/store/saved-products/resolve accepts only productIds, at most 50 distinct canonical UUIDs, and returns eligible published card projections in requested order. Missing and unpublished IDs both produce no card and reveal no private existence reason. The controller explicitly opts into the public JSON-body read policy; it does not exempt login, activation or staff mutations from origin/CSRF checks. Non-JSON requests still fail verification. The read-only, repeatable-read transaction has a three-second statement timeout. Stable IDs allow URL/name/price changes to resolve to current published values. Original files, media hashes, supplier/stock/financial records and internal publication details are excluded.

The Next.js POST /saved-products/resolve accepts JSON only, rejects query parameters, bounds streamed request bodies to 8 KiB/five seconds and forwards no browser Cookie or Authorization headers to the API. Responses are no-store. The browser validates returned IDs and media paths again, aborts obsolete requests and rechecks on list changes, foreground return and network recovery. Network failure displays Retry and preserves saved IDs; it does not label all products withdrawn. A successful omission displays a generic unavailable card that can be removed, with no stale name, price or photo. Already downloaded content cannot be recalled while a browser remains open without another read.

## Acceptance and remaining gates

Strict checks, production builds, 89 database-free cases and 47 focused PostgreSQL/publication/Next.js cases pass locally. These checks cover bounded inputs, input ordering, field stripping, staff-header isolation and withdrawal. Browser acceptance covers actual save/remove, reload persistence, cross-tab updates, quick-view controls and narrow-screen layout using disposable generated products. Exact-commit CI is the full regression gate. No real merchandise or customer data is seeded for QA.

Customer identity, durable account wishlist, optional guest merge, confirmed stock/cart/checkout, production request abuse controls, load budgets and deployment remain separate acceptance gates. This increment is a local guest wishlist, not a completed customer account or production store.

Browser evidence: generated products were saved from full details, collection cards and quick view; reload retained all IDs, a second tab updated the first without refresh, and withdrawal produced a generic unavailable card with no stale name/photo/price. Removal synchronized across tabs and the empty state was verified. At a 390px viewport, document scroll width was 375px, two cards remained readable and the menu opened beside the wishlist icon. All three saved fixture references were removed through the UI; temporary test database records, media, history and preview servers were then cleaned.
