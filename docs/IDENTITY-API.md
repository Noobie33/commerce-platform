# Staff identity API

Implemented backend increment. The staff interface is available at /admin. Public registration, staff/role editing, MFA and account recovery are not implemented yet. Local development remains the deployment scope.

## Access model

Staff sign in with a unique lowercase username (3–64 ASCII letters/digits/dot/underscore/hyphen), not a guessed business email address. Passwords normalize to NFC and require 15–128 characters at creation/change. Native asynchronous scrypt uses a fixed, versioned N=32768/r=8/p=3 profile with unique 16-byte salts and 32-byte results. This OWASP-listed profile avoids a native addon installation on Windows; it is a deliberate dependency/compatibility tradeoff rather than a custom hashing algorithm. Expensive hashing is limited to two simultaneous tasks per process.

Sessions use 32 random bytes. Only SHA-256 hashes of their authentication tokens are stored. Absolute expiry is eight hours; idle expiry is 30 minutes with one-minute touch granularity. Logout and password change revoke sessions; deactivation and permission/scope changes are checked on subsequent requests. Already authorized in-flight operations are not retroactively cancelled.

All routes are protected unless explicitly public. Authenticated-only routes must also opt in explicitly; other business routes require action metadata. Global grants use a null location. A location-only grant cannot authorize a global operation or a different location. Inactive location grants do not authorize requests.

## HTTP contract

Default local origin: http://127.0.0.1:4000. STAFF_ORIGIN must be an exact origin, with HTTPS required in production policy. No wildcard CORS or proxy trust is enabled.

All writes require Origin equal to STAFF_ORIGIN, Content-Type application/json and X-Requested-With: commerce-staff. Cross-site Fetch Metadata is rejected. Authenticated writes additionally require X-CSRF-Token matching the random synchronizer token bound to the session. The browser receives that token in login/me JSON; the authentication token stays in an HttpOnly, host-only, Path=/, SameSite=Strict cookie. Production policy additionally uses Secure and the __Host- cookie prefix. There are no GET mutations or bearer-token fallback.

| Route                             | Access                                             | Behavior                                                                                                                                     |
| --------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/v1/auth/login           | Public, origin/custom-header checked               | Body: username/password. Sets session cookie, returns safe user fields and csrfToken. Unknown user and bad password share the same 401 body. |
| GET /api/v1/staff/me              | Authenticated; permitted during forced change      | Returns safe profile, current grants and csrfToken; no password hash or raw session token.                                                   |
| POST /api/v1/auth/logout          | Authenticated + CSRF                               | Revokes current session and clears cookie.                                                                                                   |
| POST /api/v1/auth/password        | Authenticated + CSRF; allowed during forced change | Body: currentPassword/newPassword. Changes hash, revokes all sessions, clears cookie; login required again.                                  |
| GET /api/v1/staff                 | Global staff.read                                  | Bounded list of 100 safe profiles. Location-only staff.read is denied.                                                                       |
| GET /api/v1/locations/:locationId | locations.read for that location or global         | Returns an active permitted location.                                                                                                        |
| GET /api/v1/health/live           | Public                                             | Process liveness only.                                                                                                                       |
| GET /api/v1/health/ready          | Public                                             | Runtime database connection and expected application schema revision.                                                                        |

Request bodies are limited to 16 KiB; unexpected fields are rejected. Malformed JSON/oversized body responses never echo input. Responses are no-store and include server-generated request IDs. Database exceptions return generic 500 responses.

## Audit and abuse controls

IP and username login buckets persist in PostgreSQL (30 and 15 attempts per 15-minute window). IP comes from the actual socket, not spoofable forwarded headers. Password-change attempts have a separate per-staff limit. Production reverse-proxy trust and edge rate limiting must be configured and tested before deployment.

Successful login/session creation, logout and password change commit with their audit event. Audit failure rolls back the mutation. Failed login and permission denial are also recorded. Audit payloads accept only explicit action/context fields, not bodies/passwords/hashes/tokens. Runtime has append/read rights but no update/delete/truncate on audit. Migration/database owners remain privileged; this is operational audit, not independently tamper-proof archival storage.

## Operations

- npm run db:migrate: reviewed compiled migrations plus explicit restricted table grants. App startup never migrates. Runtime cannot read migration history or edit schema revision.
- npm run staff:bootstrap-owner: local development-only, one-time owner creation. Refuses existing staff/credential artifact. Generated credentials go to .local-setup/owner-access.json; Windows ACLs restrict the folder/file to the current user and SYSTEM. First-use password change is mandatory.
- npm test: configuration, HTTP and security unit tests without a real database.
- npm run test:database: sequential dedicated-PostgreSQL integration suites; fixtures are isolated and cleaned. Never target existing business databases.
- npm run format:check / npm run check: style and strict TypeScript gates.

Schema grants are an explicit migration-deployment step. Failure there leaves readiness unavailable until corrected; it never silently promotes runtime to an administrator. Provisioning/migrations and bootstrap refuse conflicting state rather than deleting existing records.

## Remaining production gates

Staff/admin screens and staff/role assignment management, MFA/recovery, password-blocklist policy, independent audit retention/export, expired-session/rate-bucket cleanup, trusted proxy/TLS deployment, metrics/alerts, backup restore and security/load review remain separate work. Local bootstrap files are not a production secrets-management solution. No production or complete ERP readiness is claimed.

Primary references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Nest authorization](https://docs.nestjs.com/security/authorization).
