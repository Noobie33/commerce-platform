# Photo enlargement and public size guides - 11 November 2026

## Delivered behavior

Product photos now open a native full-viewport viewer from the full product page or quick view. Fit, zoom in/out, keyboard shortcuts (+, -, 0), scroll and mouse drag provide inspection. Application zoom stops at the existing approved display derivative's native pixels; it never fetches staff originals or generates a larger file. Video retains its existing native controls. Escape restores the photo trigger; when opened inside quick view, the first Escape closes only the photo viewer.

Approved size guides appear only when assigned to the published release. The Size Guide control opens a right-side panel matching the [reference product](https://www.aarong.com/bgd/off-white-striped-taaga-man-panjabi-31eo262006014.html), inspected directly in the browser. Our table uses the actual title, measurement convention, units, instructions and exact decimal strings. It does not copy reference measurements or assume a garment/body convention. No guide means no empty or invented Size Guide control. Wide tables scroll within their own keyboard-focusable region.

## Data boundary and technical choices

The existing public release snapshot already contains its reviewed merchandising projection. The frontend now allowlists only the pinned guide's title, revision, unit, basis, instructions, columns and values from that projection; it never reads the private library endpoint. Unknown notes/IDs are omitted. Invalid, malformed or retired chart payloads fail validation. Legacy releases without guide assignments remain compatible.

The original schema-17 library/assignment rules and schema-25 publication gate remain authoritative. Editing a library guide does not replace the version pinned to an existing product. Explicit reassignment and content review/publication are required to change published measurements. No new migration, production seed, financial/inventory write or public original-download route is introduced. Current approval checks and no-store media delivery remain unchanged. Already received browser content cannot be recalled.

Native dialogs provide focus containment and Escape behavior, including the photo viewer nested within quick view. Resizing recomputes a fit scale; zoom and pan change only presentation. Touch devices retain native scroll/pinch behavior. Original masters and generated display files are unchanged.

## Acceptance evidence

Strict checks and production builds pass. The local database-free suite reports 85 passing cases and the focused real PostgreSQL/publication/Next.js suite reports 41. Tests cover exact guide decimals/units, rejected malformed/inactive charts, public field stripping, safe rendering and a guide-v2 update leaving the published v1 measurements intact. Complete exact-commit CI remains the release gate.

Disposable browser fixtures used a 1200 x 1440 generated photo, two SKUs and a six-column garment chart in cm. Desktop Fit measured 39%; at 100%, rendered dimensions were exactly 1200 x 1440 and Zoom In was disabled. Mouse drag changed the viewer's scroll position. At a 390px viewport the page remained 390px wide while the guide table scrolled inside its 350px region (675px content). Arrow-key scrolling, native focus restoration and two-level Escape dismissal were verified. Test guide v2 held changed values while the published panel retained v1's 98.50 measurement. All generated records/files and test servers are cleaned up after acceptance.

Accounts/wishlist, related merchandising, cart/checkout, payments, fulfillment and production deployment remain separate delivery work. See [product details and quick view](PRODUCT-DETAILS-AND-QUICK-VIEW.md) and [the reference register](STOREFRONT-REFERENCE.md).
