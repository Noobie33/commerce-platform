# Local staff interface

Open http://127.0.0.1:4000/admin while the local application is running. The root URL also serves the sign-in page.

## Available screens

- Sign-in using existing staff credentials.
- Forced first-use password change.
- Workspace overview with real session/access state and live readiness status.
- Read-only staff directory with local search and explicit 100-account limit.
- Profile, location/action access summary and password change.
- Working sign-out, session-expiry handling, loading, empty-result and failure states.
- Responsive desktop/compact navigation with keyboard focus, Escape/Tab handling and skip link.

The catalog screen supports real product/variant create, view, edit, search, category/status filters and pagination. See [catalog decisions](CATALOG.md). Inventory and purchasing/sales remain planned; no business totals or placeholder transactions are presented as real data. Staff/role editing and audit-history UI remain future slices.

## Reference-driven visual refresh

The catalog now has a white/light-gray and orange visual system, readable Segoe UI/system type, desktop top navigation, card/table views and an inline product details panel on wide screens. Compact screens use the same details in a modal dialog. Existing create/edit/category/search/pagination and staff screens are retained. See [interface direction and stack decisions](INTERFACE-DIRECTION.md). Product-photo upload, unchanged originals, protected original download, configurable live limits, preview, primary selection and gallery are implemented; products without photos retain a clear empty state. See [product-media guide](PRODUCT-MEDIA.md).

## Architecture and reasons

The maintained React 19.3.1/Vite 8.3.6 admin workspace lives under apps/admin. Exact versions were checked against existing Node 24.16.0 before installation. This is a private staff SPA; it does not need a second server runtime or SEO rendering. A future public storefront can choose its own rendering approach.

npm run build first compiles the Nest API, then builds the admin bundle into dist/public/admin. Nest serves only index.html and the generated assets, never the repository root or configuration files. UI and API share an origin, preserving the existing HttpOnly cookie and CSRF boundary without wildcard CORS.

The browser keeps the CSRF token in memory, never an authentication token in local/session storage. Staff data is loaded from the protected API. Responses are no-store. The index has a self-only content security policy and no external font/image/CDN dependencies.

## Start and verification

From D:\Business Software\commerce-platform:

```powershell
npm run build
npm run start:local
```

Open the URL above. Username for the bootstrapped development owner is owner; the one-time credential is in the ignored/private .local-setup/owner-access.json file. It is not bundled into the interface. First login requires password change. Do not paste credentials into chat or commit them.

Browser QA used only a disposable test-database account, leaving the real owner untouched. Sign-in, forced-change screen, overview, staff search/no-results, profile/access, compact navigation/focus and sign-out were observed. Desktop/compact page widths were checked and browser error/warning logs were empty. Actual password-change mutation is covered by PostgreSQL HTTP tests; the browser QA did not change the user's password.

Catalog browser QA also created a category and a product with six generated size/colour variants, verified exact decimal prices, duplicate-barcode feedback, edit/archive, search/no-results and compact modal/navigation behaviour. A browser validation issue and compact-page overflow were corrected and rechecked. The final compact layout had no horizontal page overflow; background scrolling is locked during modal use and hidden navigation is inert. Browser warning/error logs were empty on the final build.

Temporary QA server/account and catalog fixtures were removed after testing. The normal local application is left available for the user. Source changes require another build; this local setup does not silently auto-deploy to the internet.

## GitHub and backups

The Git repository contains source, lockfile, documentation and CI, not .env files, private setup SQL/credentials, node_modules or build output. secrets:check checks tracked files and committed history against credential patterns and current local secrets without printing them.

The CI workflow uses pinned official action revisions, Node 24 and a disposable PostgreSQL 18.6 service. It runs type/style checks, local tests and real database/security integration tests with ephemeral generated credentials. It never uses the development owner's credentials.

GitHub is a code history/backup destination. Database backups and restore testing are separate work; no database contents are published with the source.
