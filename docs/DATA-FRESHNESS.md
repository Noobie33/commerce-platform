# Live staff updates and recovery

Implemented 10 November 2026, schema 16. This extends the earlier automatic-read policy: server push is now the primary change signal; a 30-second read remains a safety reconciliation, including time-based stock-hold expiry. Native Fetch still retrieves authorized data and performs writes. There are no new package dependencies or paid services.

## Why these choices

Use same-origin, cookie-authenticated Server-Sent Events (SSE) for server-to-browser invalidation. Staff writes already use HTTP/Fetch; bidirectional WebSocket messaging is unnecessary for this workflow. A single stream per signed-in browser tab serves its visible lists. [NestJS SSE guidance](https://docs.nestjs.com/techniques/server-sent-events) describes this server-push transport.

Use PostgreSQL LISTEN/NOTIFY on a dedicated runtime connection per application instance. Schema 16 adds notification triggers to the explicit catalog, inventory, purchasing, customer, sales and access tables. A transaction's hints reach listeners only after commit; rollback produces none. This also covers changes made by a different application instance or an authorized database connection. Notification payloads contain only allowlisted topics and, internally where needed, a location UUID. Browser frames contain only coarse topics; no customer contacts, amounts, quantities, record IDs, session tokens or snapshots. [PostgreSQL NOTIFY semantics](https://www.postgresql.org/docs/18/sql-notify.html) support commit-time delivery and folding of identical hints within a transaction.

These are disposable cache-invalidation hints, not a durable event log or business queue. A lost event is repaired by rereading the current authorized state. Payments, courier jobs and other future guaranteed side effects require their own transactional outbox/retry design; they must never depend on this stream.

## Visible behavior

Catalog, customer, stock/location/history, sales, supplier/purchase-order, invoice, payment, aging and team lists react to relevant permitted changes. The UI displays `Live updates connected` while the server's database listener is available. Lost browser/database connections show a recovery/fallback state. EventSource reconnects; a recovered connection requests a fresh read to cover any missing hints. Focus, reconnect, visibility return and 30-second safety checks also reconcile data. Delivery is near real time, subject to network and request duration; there is no zero-latency guarantee.

Server notification batches use a short 100 ms delay. Browser invalidations coalesce with a minimum request spacing; notifications arriving during an active request remain pending and trigger a subsequent read. Hidden/offline views and open editors/details pause reads. Pending changes reconcile after the view is safe again. Typed text, reviewed prices, report cutoffs and content-review snapshots are not silently rewritten. Query changes create a separate resource; old responses cannot overwrite a newer query.

During temporary read failures, last successful rows and check time remain visible with a retry message. Search/filter/page/card choice remains intact, with pagination clamped when a result set shrinks. Refresh/Retry is retained as a manual fallback. Existing save callbacks continue immediate local invalidation. Detailed record panels retain their deliberate read/review/save flow.

## Security and bounded resources

The stream requires the existing protected staff cookie and default-deny guard; it is marked as a background read on the server because EventSource cannot set the ordinary background header. Opening/reconnecting, heartbeats and notification checks never renew idle activity. Authentication and current grants are checked before notification delivery and every 15 seconds. Idle expiry, logout/revocation, deactivation and forced password change close the stream. Cross-site/origin-mismatched requests are rejected. No credential is placed in a URL.

Inventory hints are filtered by current location grants before their location identifiers are discarded. Other feature topics require the corresponding global read grants. Access changes produce a generic reconciliation signal after authentication is rechecked; actual list APIs remain authoritative and clear private cached rows on denial. A hint is never authorization to read a record or mutate stock/money.

Streams are capped at five per staff member and 256 per process. Slow clients are closed instead of buffering an unbounded history. Pending server hints are capped and overflow becomes a generic reconciliation. Request/listener timers, disconnected clients and the dedicated PostgreSQL connection are released on shutdown. Database listener failures use bounded exponential reconnect delay, up to 30 seconds. Stream traffic is optional for business correctness; normal authorized APIs and recovery reads remain available when it fails.

## Verification and deployment gates

Required checks include pure controller and browser-connection tests, real HTTP session/scope tests, commit versus rollback, delivery across two application instances, listener termination/reconnect, permission removal, idle expiry and migration revert/reapply. UI verification uses disposable test-database fixtures on a separate loopback hostname, checks external updates before the safety interval, and confirms an open unsaved form survives.

Local evidence: 48 unit/interface tests and 200 reported PostgreSQL checks passed. The schema-16 development migration applied once and left all 48 existing data-table fingerprints unchanged; its pre-migration backup was restored and compared in an isolated PostgreSQL instance. A disposable browser check observed an external change trigger a read in 304 ms, with unsaved text preserved and pending changes applied after closing the form. This single local measurement is not a performance guarantee.

Production remains a separate gate: validate TLS/cookies, reverse-proxy buffering disabled, streaming timeouts longer than the heartbeat, HTTP/2 or browser connection limits, shutdown under active streams, load/connection capacity, monitoring and recovery. LISTEN needs a persistent database session; do not route it through transaction-mode pooling. Current database configuration deliberately remains local only. This increment does not establish production readiness or a universal enterprise-capacity claim.

Reusable size guides, collections/category vocabulary, publication and the remaining retail lifecycle are still the product roadmap. This change does not publish a storefront or implement checkout.
