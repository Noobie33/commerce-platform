# Automatic staff-list updates

Implemented 10 November 2026. Native Fetch already handled asynchronous requests; a Refresh button has always requested data without reloading the page. Fetch is the transport. Automatic revalidation is the separate policy added here.

## Behavior and scope

Visible catalog/category, customer, stock/movement/location, supplier/purchase-order, supplier-invoice, supplier-payment, payable-aging and team lists check for changes every 30 seconds. Focus, reconnect and returning to a visible tab also trigger a check, with a short duplicate-event throttle. An update is a fresh authorized server read, not a browser page reload. Saved changes still invalidate the relevant list immediately through the existing save callbacks.

This is periodic refresh, not instantaneous push delivery. A timer may run later in a suspended/background browser. There is no request while hidden, offline, already fetching or paused for an open record. No websocket service or additional dependency is needed for this bounded local increment.

The status line shows the last successful check in Dhaka time and distinguishes updating, paused, offline and failed refreshes. Existing data remains visible during background reads and temporary failures. Refresh/Retry remains an explicit fallback. Search, filters, pagination and card/table choice stay in place. If removal shrinks a result set, pagination moves to its last valid page.

## Editing and correctness

An open editor, detail/review panel or document workspace pauses background list checks. The payable-aging report also pauses while its filters have unapplied edits; its chosen report date stays fixed. Existing detail views, supplier-picker searches and transactional forms retain their deliberate read/review/save flow. Automatic reads do not replace typed text, reviewed prices or approval snapshots. Server-side permissions, revision checks, transactions and stock validation remain authoritative on every write.

One controller owns each query's request generation and abort signal. Automatic requests coalesce; an explicit retry supersedes the older read. Late responses cannot replace newer results or publish after unmount. A changed query starts without rows belonging to its previous filter. React subscriptions, focus listeners and timers are cleaned up on unmount.

## Sessions and privacy

Only automatic GETs carry `X-Background-Read: 1`. The server still checks session validity, idle expiry, active staff and current grants, but does not renew session activity for those reads. Normal interactive requests retain existing activity renewal. Writes cannot turn off their normal authentication/CSRF behavior by adding that header.

Authentication/permission failures clear the affected list's cached private rows. A permission failure stops its automatic retries until an explicit retry or changed query. Expired authenticated sessions also use the existing sign-in transition. No database migration or stored business-data conversion is involved.

## Verification and remaining work

Focused controller tests cover polling, overlap, hidden/offline/edit pauses, reconnect, transient errors, access revocation, request supersession, cleanup and remount. Real PostgreSQL/HTTP tests verify background idle behavior, normal activity renewal, expired sessions, scoped permissions and write protection. Existing unit and database suites remain required.

Browser verification uses disposable fixtures in the isolated test database, on a separate loopback hostname from the development account. Operational push notifications and detailed cross-user edit conflict indicators can be considered later if measured needs justify them. Size guides, collections/category vocabulary and publication remain the next product-content roadmap work; this freshness increment does not implement them.
