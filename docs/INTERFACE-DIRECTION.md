# Interface direction and frontend decisions

## Reference and scope

The owner supplied a screenshot and screen recording on 8 November 2026 to communicate a preference for a clean fashion admin interface: white/light-gray surfaces, orange accents, structured product cards, clear filters and a product detail panel. The implementation adopts that direction with neutral Commerce branding.

The reference describes inventory, ratings, sales statistics, brand/gender filters, offers and orders. Those are inputs to the product roadmap, not proof that those workflows already exist. The redesign preserves every implemented catalog action and the existing staff/security boundary.

## Frontend stack

| Part              | Existing project version                 | Reason                                                                        |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| React / React DOM | 19.3.1                                   | Component-based interactive staff workspace                                   |
| TypeScript        | 6.0.3                                    | Strict contracts and early detection of invalid data assumptions              |
| Vite              | 8.3.6                                    | Builds the private browser interface without another application server       |
| CSS               | Local shared tokens and component styles | Consistent spacing, contrast and responsive layouts with no new UI dependency |
| API access        | Native fetch                             | Same-origin HttpOnly sessions and the existing CSRF flow                      |

Versions are pinned in the lockfile. No application dependencies were added for this redesign. Public storefront rendering can be selected separately when the online-store slice begins; the private staff SPA does not need search-engine rendering.

## Design rules

- Use Segoe UI/system typography, readable labels and calm neutral surfaces. Avoid external font/CDN dependencies.
- Orange identifies primary actions and the selected product. Dark text on orange preserves readable button contrast.
- Desktop navigation runs across the top; compact screens retain the accessible navigation drawer.
- The catalog defaults to cards, with an operational table view available on the same data.
- At wide widths, selecting a product opens a non-modal side panel. At smaller widths the same information uses a keyboard-accessible dialog.
- Existing search, category filters, pagination, category creation, product creation/editing, variant generation, immutable identifiers, exact prices and stale-edit handling remain available.
- Product status filters are All products / Active / Draft / Archived. These represent catalog state, not inventory availability.
- Cards show the primary protected product thumbnail. Products without photos use an explicit no-photo state. Validated uploads, gallery and primary selection are implemented; see [product-media decisions](PRODUCT-MEDIA.md).
- Quantities, low-stock thresholds, ratings, popularity and sales statistics require real upstream records. Do not display invented numbers or unsupported filter controls.

## Source organisation

Shared layout/type/palette rules live in apps/admin/src/styles/theme.css. Catalog-specific surfaces and form styles live in apps/admin/src/catalog/catalog.css. ProductGrid, ProductVisual and ProductDetail are small dedicated components. The existing editor and API/security modules are retained.

## Verification

Browser QA uses only a disposable account and fixtures in commerce_platform_test. It covers card selection, inline details, table switching, draft filtering, exact-price edits, product creation, search/no-results, responsive dialogs and navigation. Temporary records are removed afterwards. Static checks and the protected document/assets test supplement browser verification.

## Next increments

1. Multi-location inventory: immutable stock movements, receipts, transfers, adjustments, availability and low-stock policy.
2. Additional catalog attributes and B2B pricing: business-approved gender/brand/material/care taxonomy, price lists and filters.
3. Purchasing/sales/customer/payment workflows, then a public store using real catalog and inventory data.

Media extensions (ordering, variant image association and remote storage) follow the documented media roadmap.

Ratings, offers, channel sync and sales-derived labels should be added with their source workflows and permission/audit rules, not just their visual controls.
