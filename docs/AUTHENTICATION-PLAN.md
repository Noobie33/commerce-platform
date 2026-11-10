# Staff identity, permissions and audit: implementation rationale

Implementation is now covered by IDENTITY-API.md. This file preserves the design/acceptance rationale; [Owner-controlled role and existing-staff access screens](STAFF-ACCESS-ADMINISTRATION.md) are now implemented in schema 20. [Secure onboarding and first activation](EMPLOYEE-ONBOARDING.md) are implemented in schema 21. Recovery, MFA and production gates remain future work.

## Decisions and reasons

Use server-managed opaque staff sessions rather than long-lived self-contained JWTs. Staff deactivation, logout and permission changes must take effect promptly. Generate session identifiers from 32 cryptographically random bytes; store only their SHA-256 hashes in PostgreSQL and enforce idle/absolute expiry. Never log credentials, cookies or raw tokens. A future storefront customer identity is a separate access boundary from staff identity.

Use a maintained password-hashing implementation. Argon2id is preferred; if its Windows/runtime compatibility is unsuitable, Node's native scrypt is an acceptable reviewed alternative. Pin and benchmark the chosen profile against current OWASP guidance, limit concurrent expensive login work, and test malformed/legacy hashes. Do not implement a custom encryption or hashing algorithm.

For the staff browser app, prefer same-origin deployment with HttpOnly cookies, Secure in HTTPS deployments and an explicit SameSite policy. Choose and implement CSRF defenses before cookie-authenticated state changes are enabled. Do not infer browser security from CORS alone. Session rotation, logout and deactivation are required, not follow-up nice-to-haves.

Protect business routes by default with authentication ahead of authorization. Only liveness, readiness and explicitly designated authentication endpoints may be public. Authentication failure returns generic errors, including for unknown usernames. Permission checks use an action code and optional location scope. A location-scoped grant must not authorize global operations; a UI-hidden button is not an access-control boundary.

Audit successful/failed login, logout, staff/role/scope changes and business postings. Write successful state changes and their audit events in the same database transaction. Runtime access may append appropriate audit records but must not update/delete them. Do not put passwords, password hashes, tokens or unrestricted request bodies into audit JSON. Operational audit is not a claim of cryptographic tamper-proof storage; independent retention/export and backup controls are a later release gate.

Initial owner creation is a local CLI operation with restricted credentials, not public self-registration. No default admin password. Provisioning should refuse duplicate owners, produce any one-time secret only in a private local artifact and require first-use password change. No email/provider credentials are needed until notification/recovery is implemented.

## Schema and application boundaries

Identity module owns staff users, password verification, sessions and authentication guard. Authorization owns permissions, roles, role-permission grants and staff-role/location assignments. Organization owns locations. Audit owns its append-only repository. Domain services own transactions; controllers validate input and present explicit response fields.

Migrations are reviewed source files registered explicitly so compiled JavaScript deployments discover the same migrations. The migration account owns schema changes. Grant only necessary table operations to runtime; keep migration history and password/bootstrap artifacts inaccessible to HTTP responses. Integration tests use commerce_platform_test, never the development or existing business databases.

## Acceptance gate

- Empty-database migration, repeated apply and test-only revert pass; constraints reject duplicate staff username, invalid scopes and orphaned references.
- Login/logout/revocation/expiry work with real PostgreSQL; no password or raw session token is stored in logs/audit.
- Unknown account and bad password return indistinguishable public errors; login attempts are throttled and expensive hashing concurrency is bounded.
- Missing/forged/expired/revoked credentials fail; deactivated staff fail.
- Permissions and location scope are checked server-side, including denial across locations and explicit global operations.
- CSRF/cookie protections pass HTTP tests for the chosen deployment topology.
- Forced transaction failure leaves neither a successful business mutation nor a misleading success audit.
- No UI, production readiness, MFA or account recovery is claimed until those features are implemented and verified. Recovery, MFA policy, backup/restore and security review are production gates.

## Primary guidance consulted

[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Nest authorization](https://docs.nestjs.com/security/authorization). The design above applies that guidance to this staff ERP; exact implementation is subject to compatibility and integration tests.
