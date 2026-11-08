# Catalog: first business slice

## Available workflow

The collection supports a card grid and a table view. Product details open beside the grid on wide screens and in a dialog on compact screens. See [visual direction](INTERFACE-DIRECTION.md).

Open /admin#catalog after signing in. Users with global catalog.read can search/filter/paginate and view products; global catalog.manage adds create/edit/category actions. Location-only grants do not authorize global master-data changes.

Create a style, optionally select/create a category, and enter variants individually or generate size/colour combinations. Every SKU has its own price, optional barcode and active flag. The editor handles up to 50 variants and the API enforces a 16 KiB request limit. This is an initial interactive editor, not a bulk import tool.

Draft, active and archived are explicit product states. An active product needs an active variant. Archived records and inactive variants remain in history. Saved style codes, SKUs and option attributes are permanent; deactivate a variant and add a replacement when an option changes. Saved variants cannot be removed from an edit.

## Technical decisions and reasons

- A product represents a style; a variant represents a sellable SKU. Inventory, purchasing and sales will reference variant IDs rather than duplicating size/colour text.
- Prices are canonical decimal strings on the wire and integer minor units in PostgreSQL. No binary floating point is used for money. This increment explicitly supports BDT only; additional currencies require currency exponent rules before enabling them.
- Categories can have a parent. Names support Unicode and are normalised for sibling uniqueness. Category editing/reparenting is deferred.
- SKU uniqueness is global, including inactive records. Barcodes are optional and globally unique when present. Only active variants need unique normalised option combinations within a style.
- Product saves run in one transaction with variants, the audit event and idempotency record. A failed audit rolls back the entire save. Stable UUID save keys make retries return the original response instead of duplicating a product.
- Updates require expectedVersion. A row lock and version check reject stale edits with HTTP 409 rather than silently overwriting another staff member.
- Identifier locks use a deterministic order for concurrent saves; database constraints remain the final integrity boundary.
- Runtime credentials have only the required table/column permissions. They cannot delete catalog history or rename saved identifiers.
- Explicit allowlists validate request bodies. Parameterised queries, bounded pagination and literal wildcard escaping keep search safe and predictable.
- The frontend stays organised into workspace navigation, pages, catalog components and shared dialog/access/API helpers. It uses the existing same-origin cookie/CSRF boundary.
- Native dialogs provide modal focus handling and Escape dismissal. Forms expose real loading, validation, duplicate, stale-edit and failure states. Desktop and compact layouts use the same records, never fabricated stock totals.

## API

All routes live under /api/v1/catalog.

| Method | Route         | Permission     |
| ------ | ------------- | -------------- |
| GET    | /categories   | catalog.read   |
| POST   | /categories   | catalog.manage |
| GET    | /products     | catalog.read   |
| GET    | /products/:id | catalog.read   |
| POST   | /products     | catalog.manage |
| PATCH  | /products/:id | catalog.manage |

Authenticated writes require the existing exact Origin, JSON, X-Requested-With and CSRF headers. Product writes also require X-Idempotency-Key (UUID). PATCH requires expectedVersion. List filters: search, status, categoryId, page, pageSize (maximum 50).

## Verification and remaining scope

Database tests exercise actual HTTP permissions/CSRF, Unicode categories, exact prices, concurrent retries, key/body/actor mismatch, stale edits, SKU/barcode conflicts, identifier immutability, variant replacement, literal search, pagination, audit rollback and migration apply/revert.

Inventory quantities, purchase cost, tax/discount policy, B2B price lists, product photos/media storage, bulk import, stock movement, purchasing and sales are separate upcoming slices. A retail price in this catalog does not mean inventory or a posted financial transaction exists. Production rollout still requires the documented hardening, recovery and operational work.
