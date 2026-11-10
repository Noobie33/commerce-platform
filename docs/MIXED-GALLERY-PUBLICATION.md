# Mixed photo/video release binding

Schema 25 extends the schema-24 private ordered draft with a separate public gallery review and an explicit product publication decision. No current draft, private video approval or existing photo-only product is automatically converted to a public mixed gallery.

## Geometry contract

Original photo/video files remain unchanged. Display derivatives preserve natural orientation and aspect ratio and are never enlarged. Photos fit inside a 2560px maximum-edge preview; thumbnails fit inside 480px. Video playback fits inside a 1920px maximum edge (even codec dimensions may round by a pixel or two), up to 30fps; poster fits inside 640px. Encoding is a separate optimized copy and is not mathematically lossless. A 1080x1920 portrait clip remains 9:16; an allowed 2160x3840 clip becomes 1080x1920. Square and landscape media remain square/landscape. No permanent 9:16 upload requirement, center crop or letterbox burn-in is introduced.

Private staff previews use contain; they do not define the future customer storefront layout. Public gallery DTOs include native display width/height, ordered kind, descriptive label, variant association and derivative links. Next.js must use these dimensions to reserve stable space, fit complete media without stretching and offer full view; any standardized card frame must not silently crop or overwrite source files. Product photography guidance is distinct from an enforced file format.

## Approval and publication

Staff save the private order first. A catalog.media.review holder reviews the exact saved order and explicitly confirms publication rights and suitability. Approval requires descriptive alternative text, current separate photo/video approval, a primary photo first and verified derivative bytes. The initial public video policy accepts silent clips only; caption/transcript/audio accessibility work is required before audio clips can be published. Rights confirmation cannot be supplied as a decoder/hash attestation by the browser.

A separate catalog.publish holder explicitly publishes the product. The new release freezes the approved order and safe display metadata. Existing content/category/photo checks still apply. Existing photo-only releases remain photo-only until a new explicit publish includes an active valid mixed approval. Revoking the mixed approval permits a subsequent explicit photo-only publication.

Editing just the private draft does not alter an approved order or a live release. Eligibility is bound to the reviewed selection, not unrelated private draft changes. Changes to a selected asset, its approval, variant activity, or public gallery consent withdraw the mixed release. Reapproval requires a new explicit publish. Both the product and its derivative video links check current eligibility; old release-version links cannot serve a later publication.

## Delivery and retention

Only sanitized playback MP4 and WebP posters have public routes, scoped by product slug, release version and selected video ID. Originals, artifact IDs, integrity hashes, filesystem paths and worker data remain private. Files are hash verified; removed, missing and tampered bytes fail closed. Playback supports validated single byte ranges (206/416), never arbitrary files or multiple ranges. No-store avoids a browser/CDN retaining a revoked public response; revocation cannot retract bytes already downloaded or already in flight. Poster and playback responses share a bounded local admission limit.

Public video delivery remains gated to the configured loopback local-development environment. Public internet deployment still requires isolated native workers, OS resources/network/filesystem controls, abuse limits, capacity/backup/retention policy, operational recovery and load acceptance. No production-readiness claim or hosting service is introduced.

Three additive review/history/request tables retain consent decisions. SECURITY DEFINER functions use a fixed search path and independent staff checks before idempotent replay. Old publication/eligibility functions are private delegates and the runtime loses direct execute grants on them. New publication and its gallery snapshot/history commit together. Downgrade refuses retained review or mixed-release history.

## Remaining work

The actual Next.js customer pages/gallery, responsive image/video delivery variants, storefront navigation and checkout remain separate work. This API and permission boundary does not create a customer website by itself.

## Verification - 11 November 2026

The full local regression passed 77 unit/interface, 14 real-codec and 323 PostgreSQL checks. Final focused publication acceptance passed 33 checks after strengthening cached-receipt and simultaneous withdrawal assertions. It verifies a real 180x320 (9:16) video, exact original retention, safe public metadata, byte ranges and old/foreign/original URL denial, draft independence, tamper denial, fresh review after selected-media changes, withdrawal versus publish, fresh permissions before cached replay, audit rollback and compiled migration retention. The final exact source is independently checked by CI.

Real browser acceptance on a fictional product saved a photo/video order, verified approval disabled during unsaved edits, confirmed rights, approved without automatic publication, explicitly published the product, then revoked the gallery from a 390x844 mobile viewport. The published projection contained photo then 400x480 video, demonstrating another native ratio, and actual public range playback returned 206. Both the product and its old video URL returned 404 after withdrawal. All 22 controls fit the 390px dialog/document without horizontal overflow. A checkbox alignment refinement was rebuilt and visually rechecked. Screenshots were saved, viewport restored and the temporary tab closed. Only the explicitly identified fictional test product/category/media/history/staff/session were removed; test invariants then reported zero rows and zero invalid histories.

A fresh schema-24 exported-snapshot backup restored in isolation and matched all 82 table/sequence fingerprints. Development advanced once to schema 25, with every one of its 76 previous data-table fingerprints unchanged. Readiness, admin and existing public browse returned 200 after restart; development and test media/review invariants remained clean. No real product was published, no credentials were reset, and no new package or paid service was introduced. The worker startup text now distinguishes processing from the separate publication decision.
