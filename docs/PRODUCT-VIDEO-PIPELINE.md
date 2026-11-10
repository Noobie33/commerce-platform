# Product video delivery plan and private preparation engine

10 November 2026. Schema stays 22. V1 preparation is implemented and tested locally; catalog upload, durable processing jobs, staff screens and public video are not enabled by this increment. The Next.js customer website will eventually consume approved mixed photo/video media; it is not built here.

## Why separate preparation from upload and publication

A file extension is not media validation, and a successful upload is not permission to publish. Reuse the current NestJS authorization, versioned review/publication and private-original boundaries. Media decoding is expensive native work: prove conversion/integrity/failure behavior before wiring any browser upload. No HTTP route, staff permission, live stock/financial table, original photo, content fingerprint or existing public release changes in this slice.

Delivery gates:

1. V1 - implemented: explicitly configured, bounded local MP4/MOV inspection and preparation; unchanged original, sanitized H.264/AAC MP4 playback, WebP poster, hashes and a private prepared bundle. Strict/real-codec checks must pass on Windows and CI.
2. V2 - next: authenticated streaming intake into private quarantine; durable database-backed job/lease/retry/cancellation states; a separate low-privilege processing worker; reference-aware orphan/crash reconciliation; request idempotency and current actor/revision checks; audited metadata changes; product/variant associations and ordered photo/video media; staff progress/retry/remove controls and safe original download. Test concurrent workers, interrupted intake, expired leases, duplicate retries and audit failure. No public video yet.
3. V3 - explicit review/publication: reviewer-approved poster/video hashes, descriptive text and audio/caption/transcript policy; safe versioned public DTO; immediate withdrawal/revocation; protected byte-range playback; photo/video gallery controls, no audible autoplay, reduced-motion/data preferences and mobile/keyboard acceptance. Preserve existing photo-only approvals/releases through an explicit migration compatibility design. Validate ready-state files and all publication gates before any public URL. Next.js/CDN cache behavior must respect revocation.

Do not quietly collapse these gates into a synchronous web request or treat a private prepared file as an approved catalog asset. Production requires an isolated low-privilege worker/resource policy, decoder security maintenance, safe storage permissions, restore/reconciliation, monitoring, upload abuse controls and measured workloads before enabling uploads. The current child process is not an OS security boundary.

## Tools and local setup

Existing Node/npm/Sharp are reused. FFmpeg/FFprobe were not found on PATH or checked common local locations. The official FFmpeg download page points to the Windows provider Gyan. Its stable non-prerelease 9.0.2 release (20 September 2026) supplies an essentials ZIP with the required libx264, AAC and libwebp encoders. The 114,768,076-byte archive matched the published SHA-256:

60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba

The archive was validated before extraction, archive paths were constrained to the selected tool directory, and binaries/version/encoders were checked. Tools, archive and provenance are project-local under ignored .local-setup/tools/ffmpeg-9.0.2. No global PATH, registry, Windows service, Node package or paid provider was installed/changed. The binaries are not committed or redistributed with the repository. CI installs the Ubuntu 24.04 distribution FFmpeg package and checks the same encoder/behavior contract; exact installed versions are logged. Reassess security updates before exposing decoding to real uploads.

An ignored .env.video, separate from database/owner credentials, contains four explicit absolute paths: FFMPEG_PATH, FFPROBE_PATH, VIDEO_WORK_DIR and VIDEO_ARTIFACT_DIR. Use private directories outside the web source/output trees; linked/redirected directories are rejected. Another machine needs its own setup; project-local Windows paths are not portable configuration. The ordinary API and database-free tests remain usable without FFmpeg installed.

After a normal project build, npm run video:verify-tools checks versions/encoders. npm run test:video runs actual generated-clip checks without database credentials. npm run video:prepare-local -- followed by one absolute .mp4/.mov path writes a new immutable UUID bundle under the configured private artifact root. It never edits its input or associates/publishes a product. The command reports the private output directory and dimensions; no raw decoder diagnostics or source metadata are logged.

## Actual validation and output

Initial input scope is ftyp-based MP4 or QuickTime MOV with exactly one supported video stream and zero/one audio stream; no subtitle/data/attachment streams. MIME/container labels must agree. Metadata comes from ffprobe, not a filename. Input is copied before asynchronous work; the preserved original hash is checked again after preparation.

Defaults: 100 MB input, 0.1-120 seconds, at most 4096 pixels per edge/16,777,216 source pixels, at most 120 fps, square pixels and orthogonal rotation. VIDEO_MAX_UPLOAD_MB can be 1-200 and VIDEO_MAX_DURATION_SECONDS 1-300; these are bounded operational defaults, not permanent brand limits. Larger workloads or more formats need measured resource/quality acceptance. Ordinary 8-bit SDR BT.709 or unspecified-color footage is supported. Explicit HDR/wide-color/high-bit-depth or ambiguous geometry is rejected rather than silently tone-mapped. Legacy MOV without a first ftyp atom, WebM/AVI and unsupported audio/stream layouts are outside this initial contract.

The original binary remains byte-for-byte intact. Playback is a separate lossy H.264/yuv420p MP4 (CRF 20, capped rate), maximum edge 1920, up to 30 fps, even dimensions, no enlargement; optional audio is AAC stereo/48 kHz/128 kbps. Original HD/4K fidelity lives in the original, not the compressed playback. Rotation is applied to actual pixels. Source tags/chapters are removed; a seekable fast-start MP4 is produced. A WebP poster (max edge 640) comes from that sanitized playback, with no EXIF/XMP.

One process-wide active job, two decoder/encoder threads, a ten-second probe/poster deadline, a ninety-second transcode deadline, bounded stdout/stderr, max 80 MB playback and 1 MB poster limit resource use. Children are launched with explicit paths/argument arrays, no shell, no stdin/window, file-only protocols, MOV demuxing and external data references disabled. Original/derived dimensions, duration, codec and hashes are checked; hitting the size cap must not silently accept a shortened clip. This bounds individual work, not total hostile traffic or native-process memory; production worker isolation remains mandatory.

## Private artifacts and recovery limits

Temporary jobs use exclusive generated directories. Normal success/failure, process timeout and cancellation remove only that job directory. A prepared bundle contains original.bin, playback.mp4, poster.webp and a versioned manifest with dimensions, codec facts, byte counts and hashes. Every artifact is checked before/after writing; an existing UUID directory is never overwritten; a failed write removes only its newly created bundle. The manifest is written last with prepared_private state. No media path is mapped to HTTP or placed in the public asset directory.

This is a private handoff artifact, not a durable queue, fsync/backup guarantee, uploaded product, reviewed media or publication. Abrupt process/host termination may leave orphan directories; durable state plus reconciliation is required in V2 before browser intake. Production file permissions/backup policy need separate deployment acceptance.

## Verification

Database-free tests cover strict policy/configuration, exact numeric and stream metadata, rotation, unsupported colors/formats/resources, literal process arguments, bounded diagnostics, child timeout/abort and unavailable binaries. Real generated clips cover actual H.264/AAC/WebP, original hash identity, source-metadata removal, fast-start layout, silence, portrait rotation, MOV labels, bounded resize, malformed/truncated/oversized inputs, duration/output limits, transcode timeout, process-wide admission, cleanup/capacity recovery, private roots, immutable bundles and the operational command. Test media/temporary roots are disposable and removed after assertions. No personal/customer video was opened, uploaded or published.

References checked 10 November 2026: [official Windows download links](https://ffmpeg.org/download.html), [vendor stable release](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2), [FFmpeg options](https://www.ffmpeg.org/ffmpeg.html), [ffprobe inspection](https://www.ffmpeg.org/ffprobe.html), [MOV demuxer options](https://www.ffmpeg.org/ffmpeg-formats.html#mov_002fmp4_002f3gp). Browsing extraction was intermittent; the release API, published digest and installed command help were also checked directly. These sources document tools, not proof of production readiness.

## Local acceptance evidence

Strict types, complete build, formatting, all 71 database-free/interface tests and all 14 actual-video checks passed on Windows with FFmpeg/FFprobe 9.0.2. The existing API readiness and admin smoke checks remain required at handoff; schema stays 22. No browser UI changed and no database migration or test/production business fixture was introduced. CI additionally runs the complete existing PostgreSQL regression suite. No video tests are silently skipped when tools are missing.
