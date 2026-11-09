# Versioned size guides and collections

Schema 17 adds the first reusable merchandising slice for the private staff catalog. It does not publish a storefront. Existing category trees remain separate from collection membership; SEO/category vocabulary editing, redirects, public navigation, campaign imagery/scheduling and curated looks remain later work.

## Staff flow

Catalog -> **Size guides & collections** opens a searchable, paginated library. Staff with global `catalog.read` can inspect records and their paginated version history. A separate global `catalog.merch.manage` permits creation, revision and retirement; only the existing owner role receives it automatically. Product-content preparers can select existing records with their existing `catalog.content.manage` permission, without permission to edit the shared library. Location-only grants do not authorize library management.

A size guide explicitly identifies **garment** or **body** measurements and **cm** or **inches**. Named measurement columns and size rows hold exact positive decimal strings with up to two decimal places. No floating-point conversion or automatic unit conversion occurs. The editor clears unsaved grid values, after confirmation, when switching measurement convention so an old number cannot silently acquire a different meaning. Measurement instructions explain how the customer should measure. Version history preserves the original values and reason.

Collections have their own title, description, permanent URL name and active/retired state. One product can belong to several collections while retaining its existing primary category. Collections are neutral brand groupings, not wholesale channels or sub-brands.

Open a product's **Content & review**, find an active guide/collection and select the desired versions. Save commits copy, specifications and associations together as a content draft. Its preview and immutable review history include the selected guide table and collection versions. A selected guide must cover every active SKU's `size` label before submission. Size labels match after trimming/case folding; a guide does not generate SKUs or change stock. Guide selection is optional in this pre-publication slice; final publication requirements will depend on category/product type, rather than assuming every lifestyle product needs a clothing chart.

## Version and review rules

Every library edit creates a new immutable revision with a reason and transactional audit. Stable IDs and per-type URL names remain fixed. Product assignments pin a specific revision; editing a shared guide does not silently replace measurements on existing products. Preparers explicitly select a newer revision when appropriate. Historical content snapshots keep their prior guide/table, collection text and active status.

Retirement is explicit and reversible by creating another active revision. It blocks new assignment and causes attached current review copies to become stale/incomplete. Replacing or removing retired records and submitting again goes through the existing review flow. An old approved snapshot remains an historical fact; it is not rewritten. Submitted products cannot change associations until withdrawn or sent back for changes. Approvals still require separate review permission and reasoned owner self-review where applicable.

The migration adds no links or sample records to development. With no assignments, the safe content projection retains its exact old JSON shape and fingerprint. Older clients omitting the new field retain existing assignments. New save requests carrying associations use an additional full-body retry identity; reusing an old key with different references is rejected. Original migrations 1-16 are unchanged. Snapshot/core helpers are versioned behind narrow wrappers, with runtime execution of private helpers revoked.

## Correctness and access

The library uses a stable head, immutable definitions, composite foreign keys and deferred current-version integrity. Product links enforce the correct record kind and at most one size guide per product. Runtime has read access and narrow write functions, with no direct modification rights over heads, versions, links or retry records.

Writes check fresh active/global permissions before cached replies. Ordered request/item/product locks, expected revisions and atomic audit protect duplicate requests and concurrent edits. Shared item locks hold retirement state stable during content review. Any invalid reference, stale revision, missing audit or bad measurement rolls back the entire save, including associations and retry namespaces. SQL independently validates definitions and references; HTTP validation provides readable field errors. Values remain plain text in the interface, not HTML.

Live updates invalidate relevant catalog lists after commit. Library browsing can update within its dialog; editing and selected history pause automatic list changes. Product forms keep their deliberate read/save/review behavior. Validation errors receive keyboard focus. Wide measurement grids scroll within the dialog rather than widening the page.

Initial validated bounds are 8 measurement columns, 30 size rows, 20 collection memberships and bounded text/request sizes. These protect editing, validation and response costs; they are implementation limits that can be reassessed with real workload evidence. Nothing assumes a particular garment's measurements, collection name or SKU size.

## Verification and operations

Focused tests cover independent/scoped permissions, CSRF, raw SQL denial, malformed/duplicate/exact measurements, retry body/actor identity, concurrent revision races, content/library audit rollback, frozen review, pinned old measurements, retirement, SKU coverage, literal search/pagination, permission revocation and forward/down/reapply migration safety. Existing retail, inventory, identity, media and purchasing suites remain required.

`npm run merchandising:verify-local` reports aggregate guide, collection and assignment counts and checks contiguous current-version histories without printing record content or staff details. Existing content verification checks history/snapshot consistency and stale review copies. CI runs both against the dedicated test database.

Before development cutover, restore a schema-16 database backup in an isolated PostgreSQL instance. Compare all pre-existing data tables during migration, allowing only the expected schema and owner-permission metadata additions. Product, SKU, stock, supplier, customer, order, money and old content/review rows must remain unchanged. Downgrade refuses to discard merchandising history. Encrypted/off-machine backups, production recovery targets, public media and publication remain separate launch gates.

## Local acceptance evidence

Development advanced from schema 16 to 17 after a restored-backup comparison. All 46 pre-existing non-schema/non-permission data-table fingerprints stayed identical; one permission and one owner-role grant were added as expected. Development has no sample guides, collections or assignments. The current validation set is 52 unit/interface tests and 214 reported database checks, with the final three focused upgrade/concurrency/rollback cases verified separately after the full regression pass.

Disposable browser records exercised creating a two-column garment guide (98.50 cm chest, 72.00 cm length), creating a collection, assigning both in a content draft and showing them in its safe preview. Updating the shared guide to v2 (100.00/73.00 cm) left that product pinned to v1 and its original values. At 390px, page/dialog widths were 390px and the read-only chart fit its 299px region; the editable grid remained contained. Desktop preview was reviewed and browser error logs were empty. Test records, session, media and viewport override were cleaned up.
