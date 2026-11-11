# Aarong collection-page alignment

## Direction and observed reference - 11 November 2026

The owner's latest direction supersedes the original editorial interpretation: closely follow [Taaga Man / Panjabis](https://www.aarong.com/bgd/brands/taaga-man/panjabis) for layout and shopping interactions, retaining our brand and product content. Direct browser inspection observed a compact two-row header, small breadcrumb, horizontal filter shortcuts, right-side filter drawer, sorting at the right, result count, four desktop product columns and 320 x 426 portrait source imagery. Product typography used Futura PT.

Bangladesh/BDT, retail only and a single brand remain authoritative. Do not add country or Aarong/Taaga/sub-brand switchers. Do not copy reference logos, merchandising assets or brand-specific copy into this application.

## Implemented increment

- Compact single-brand navigation and search, sans-serif collection typography and full-width results replace the previous sidebar and large editorial collection heading.
- Colour, Fabric, Price, Size and Cut / Fit shortcuts open the appropriate section of an accessible native modal at the right. Category and occasion remain available inside the same drawer. Real facets, counts, exact prices and same-SKU filtering are preserved.
- Sorting is separate from the filter drawer. Only backend-supported sorts are offered. Newest requires a publication-date sort contract and is not imitated with alphabetical ordering.
- Four desktop / three intermediate / two narrow-screen columns. Cards use a 3:4 contain frame, replacing the first preview's 4:5 choice after measuring this more specific reference. Uploaded originals, derivative geometry and native product-detail ratios are unchanged. Responsive image candidates use the existing verified image and thumbnail routes.
- Jost variable is vendored from the official Google Fonts repository under its included SIL OFL 1.1 license, served locally through next/font/local. It gives a similar geometric direction without assuming rights to redistribute Futura PT. This is not a claim of pixel-identical licensed typography.

Jost source: https://github.com/google/fonts/tree/main/ofl/jost. Original variable file SHA256: 6343b70971000b04c5d401c96ae08ce371086135e999d5e1e1413039c0213076. The adjacent OFL.txt retains attribution and license. There is no new package dependency, external runtime font request or paid service.

## Remaining reference work

This increment aligns the collection page and common header; it does not complete a carbon copy of the entire reference. Home campaign composition requires our real managed campaign content/assets. Product-detail layout, quick view, saved products/wishlist, customer accounts, cart, checkout and managed footer/policy content remain separate acceptance slices. No decorative account/cart/wishlist button is presented as a working transaction. Existing public approval/withdrawal, media rights and original-file boundaries stay intact. Schema remains 25.

## Acceptance evidence

Strict checking and optimized Next.js build pass. The real API/publication acceptance suite reports 38 passing checks. Browser inspection measured four 266.25px columns at the desktop viewport with 266.25 x 355px contain frames. Mobile shows two columns and a viewport-contained drawer. Combined colour/size submission, sorting with retained filters, exact upper-price exclusion, clear-all navigation and Escape dismissal with focus returning to the opening shortcut were exercised. The separately generated fictional product/media and their test-only servers are removed after QA. Main business data are not seeded or migrated. GitHub CI remains the final exact-commit gate.
