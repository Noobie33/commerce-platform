# Original media and configurable limits

## Quality model

New uploads retain the original file bytes unchanged, including its original resolution and embedded metadata. A SHA-256 hash, type, size and original pixel dimensions are stored alongside the photo record. A separate WebP preview and thumbnail support fast browsing.

Default previews fit within 2560 × 2560 at WebP quality 90, without enlargement. Thumbnails fit within 480 × 480. These derived copies are optimised and do not claim byte-for-byte original quality. Original downloads are checked against the actual uploaded bytes in HTTP integration tests.

Only global catalog.manage can download an active original. Downloads stream from protected storage as attachments with nosniff and a sandbox policy; originals are not public image assets. Global catalog.read still permits the normal preview and thumbnail. The display copies strip metadata; private originals retain it because they are exact masters.

Existing photos from the earlier processor remain usable. Their originals were not retained and cannot be reconstructed from the smaller WebP. They explicitly report originalAvailable=false; users can re-upload the source photo to retain an original.

## Configuration

The server exposes its current non-sensitive policy at GET /api/v1/catalog/media-policy. The upload form reads this endpoint instead of hardcoding limits.

| Environment setting      | Default                      | Valid range       |
| ------------------------ | ---------------------------- | ----------------- |
| MEDIA_MAX_PHOTOS         | 24 active photos per product | 1–100             |
| MEDIA_MAX_UPLOAD_MB      | 20 MiB per original          | 1–50 MiB          |
| MEDIA_MAX_PIXELS         | 64000000 pixels              | 1000000–100000000 |
| MEDIA_UPLOAD_CONCURRENCY | 1 receive/process task       | 1–2               |

These are resource budgets, not permanent brand restrictions. Changes require a server restart and no application code edit. Large originals use more local/cloud storage and backup capacity. Limits remain bounded so a single request cannot consume arbitrary memory or disk.

The receive deadline is 30 seconds; processing is bounded to 20 seconds. Preview dimensions remain bounded to the database's 2560-pixel limit. GIF, animated PNG/WebP, corrupt images and MIME/signature mismatches are rejected. No new package or paid service is needed for this change.

## Storage and consistency

Every new photo has three immutable objects: original, preview and thumbnail. New files are exclusively created and flushed before metadata publication. Partial writes clean up only the newly created objects, preserving any pre-existing object on collision.

Product revision checks, audit and idempotency remain one database transaction. Known unreferenced failed writes are discarded; ambiguous commit acknowledgements preserve potentially committed files for reconciliation. Removed originals remain retained and are no longer downloadable through the active-photo endpoint.

npm run media:verify-local now validates original size/hash as well as the preview, and understands legacy records without an original. Database records plus all media files are one backup/restore set; GitHub contains source only.

The schema downgrade refuses to discard original references or larger preview records. A rollback must preserve the full media backup rather than silently dropping masters.

## Why this approach

Enterprise asset-management systems keep original assets and generate channel-specific renditions. This project's implementation follows that architecture without adding an Adobe/Shopify subscription. References: [Adobe original/renditions](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/assets-view/renditions), [Shopify image upload limits](https://help.shopify.com/en/manual/online-store/images/theme-images).

Public-store delivery, configurable variant image association, remote object storage and storage quotas/retention remain separate planned increments.

Browser verification uploaded a generated 4000 × 3000 PNG: the UI showed a separate 2560 × 1920 preview and a 4000 × 3000 original. The browser's downloaded file matched the upload's SHA-256 exactly. The disposable download, test account, records and media storage were cleaned afterwards.
