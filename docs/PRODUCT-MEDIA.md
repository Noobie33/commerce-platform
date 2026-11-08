# Product photos

## Staff workflow

Save a product first, open its details, then choose Add product photos / Manage photos. Select a JPEG, PNG or WebP, inspect the local preview and upload it. Up to eight active photos can belong to one product. The first becomes primary; another photo can be selected as primary later. The primary thumbnail appears on the catalog card; the detail gallery can preview every active photo.

Photo changes save immediately, independently of the product editor. The UI preserves retry keys after a network failure, shows stale-revision errors and allows loading the latest product. Removing a photo hides it from the product and protected image endpoint; it does not physically purge retained files or historical records.

## Required dependency and image policy

Sharp 0.35.5 was selected after checking the existing installation, registry version/integrity, Node >=20.9 requirement and Windows/Linux prebuilt support. The project uses Node 24.16.0. Its version is pinned; no frontend upload library or multipart parser was added.

- Accept JPEG, PNG and WebP only, verified by magic bytes and decoded format.
- Reject animated, corrupt, empty, oversized and mismatched input.
- Maximum input: 5 MiB compressed and 16 million pixels.
- Normalise orientation and re-encode to WebP, with a maximum 1600-pixel edge.
- Produce a separate thumbnail with a maximum 480-pixel edge.
- Strip input metadata through the default Sharp output pipeline; camera EXIF/XMP is not retained.
- Bound uploads to two concurrent receive/process operations, with a 15-second receive deadline and a 10-second image-processing deadline.
- Store generated UUID names only. Original filenames, source bytes and file paths are not stored in catalog/audit responses.

Technical references: [Sharp installation](https://sharp.pixelplumbing.com/install/), [input limits](https://sharp.pixelplumbing.com/api-constructor/), [output and metadata](https://sharp.pixelplumbing.com/api-output/).

## Authentication and API

All operations require the existing staff cookie. Image reads require global catalog.read; writes require global catalog.manage. Origin, CSRF and X-Requested-With checks remain mandatory. Only the specifically decorated upload route accepts image content types; every other write retains its JSON requirement.

The upload body is read after authentication/permission checks. The existing JSON parser retains its 16 KiB limit. Large image bodies are bounded separately; oversized declared requests can be rejected before sending the body, and an abusive/unfinished connection may be closed.

| Method | Route under /api/v1/catalog           | Body / headers                                                                  |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------- |
| POST   | /products/:id/photos                  | Raw image bytes; matching Content-Type, X-Product-Version and X-Idempotency-Key |
| POST   | /products/:id/photos/:photoId/primary | JSON expectedVersion; X-Idempotency-Key                                         |
| POST   | /products/:id/photos/:photoId/remove  | JSON expectedVersion; X-Idempotency-Key                                         |
| GET    | /photos/:photoId/image                | Authenticated WebP image                                                        |
| GET    | /photos/:photoId/thumbnail            | Authenticated WebP thumbnail                                                    |

Successful writes return productId, version and photos. Each photo has opaque id, image/thumbnail URLs, dimensions and isPrimary. GET responses are no-store, image/webp, nosniff and same-origin. No public static media directory is exposed.

## Consistency and storage decisions

Product-row version checks and locks coordinate photos with product edits. Photo changes increment the same product revision, so an already-open product form cannot silently overwrite a newer media revision.

Photo metadata, primary selection, audit event and immutable idempotency record commit in one database transaction. A failed audit rolls back all database changes. Safe retries return the original response; different actors or request bodies cannot reuse a save key. At most one active primary photo is enforced by a database index.

Files are fully written under new UUID names before publishing metadata. Known failed/unreferenced writes are discarded. A lost COMMIT acknowledgement is ambiguous: retain files when a database reference exists or cannot be checked, avoiding deletion of a potentially committed photo. A process crash can leave unreferenced files; the verifier reports these without deleting them.

Local development defaults to the ignored .local-media directory under the active project. MEDIA_STORAGE_DIR can specify an absolute directory. Production uploads require an explicitly configured persistent, access-controlled directory; an object-storage adapter can replace LocalMediaStore without changing the catalog API.

Database and media files form one backup/restore set. GitHub backs up source only. Removed photos remain retained; retention periods, restore/purge UI, storage quotas, orphan reconciliation and remote storage are future operational work before production rollout.

## Storage verification

After building, run npm run media:verify-local. It uses restricted runtime credentials and reports record/active counts, invalid or missing files and unreferenced entries. It verifies full-image size/hash and the presence of thumbnails. It changes no files and fails when discrepancies need investigation.

## Verification and remaining scope

23 database-free/interface checks and 33 reported PostgreSQL integration checks passed locally. Media coverage includes image format/metadata/orientation/pixel limits, a valid animated WebP, immutable storage and partial-write recovery, upload concurrency bounds, actual HTTP CSRF/permission denial, concurrent retries, protected downloads, stale edits, primary/remove history, audit rollback, the eight-photo limit, restricted grants and migration apply/revert.

Browser QA used disposable test records and generated images only. JPEG/PNG uploads, previews, primary selection, gallery switching, catalog thumbnails and compact photo-management dimensions were observed. Temporary database records and storage are removed afterwards.

Arbitrary ordering, variant-specific image associations, bulk uploads, public-store image delivery and detailed media access policies remain future increments. Inventory quantities and stock movements are the next business slice.
