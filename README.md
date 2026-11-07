# Commerce Platform

Neutral backend foundation for a fashion/lifestyle ERP and future e-commerce.

Active workspace: D:\Business Software\commerce-platform. See [architecture and initial audit](ENGINEERING-PLAN.md), [engineering standards](docs/ENGINEERING-STANDARDS.md), [database decisions](docs/DATABASE-DECISION.md) and [staff identity API](docs/IDENTITY-API.md).

## Current implementation

- Managed PostgreSQL connection, schema-aware readiness and shutdown cleanup.
- Staff login/logout, NFC-normalized password hashing, forced first-use password change and revocable database sessions.
- Default-deny route protection, action permissions and location scopes.
- CSRF synchronizer tokens, strict cookies, persistent login limits, bounded hashing work and input/error redaction.
- Transactional audit events with append-only runtime access.
- Compiled migrations, restricted runtime grants and a protected one-time owner bootstrap.

There is no staff/admin UI, product catalog, inventory workflow, role-management screen/API, MFA or account recovery yet. These are not production-ready or complete ERP claims. The next usable slice is the staff/admin shell, then catalog/variants and inventory using the same access/audit foundation.

## Local commands

Requires Node 24 LTS and npm. Exact dependencies are locked in package-lock.json.

```powershell
npm ci --ignore-scripts
npm run format:check
npm run check
npm test
npm run test:database
npm run db:verify-local
npm run build
npm run start:local
```

Local API: http://127.0.0.1:4000. Health endpoints: /api/v1/health/live and /api/v1/health/ready. Ready checks database connectivity and expected schema revision; startup fails if migrations/grants are missing. App startup never changes schema. Pool size is 10 with bounded connection/query timeouts.

.env and .env.test already contain generated connection credentials. Do not overwrite them with .env.example. Keep them, .env.setup and .local-setup outside source control. npm offline mode is enabled by the environment; dependency downloads require a per-command --offline=false override rather than changing global settings.

## Owner access

The development owner exists. Its username and one-time password are in .local-setup/owner-access.json, protected by explicit Windows ACLs for the current user and SYSTEM. Do not share that file or paste its contents in chat. The API enforces a password change before business access. No browser login screen exists yet.

The saved pgAdmin connection was used for initial database/role provisioning. Direct administrator password authentication remains unresolved and is not needed for routine application/test access. Do not rerun setup SQL, automatic provisioning or owner bootstrap against the completed setup.

## Verification — 8 November 2026

Strict type checking, clean build, formatting check, 14 database-free tests and 15 reported PostgreSQL integration checks passed. The PostgreSQL checks include real HTTP login/logout, CSRF denial, scope denial, forced password change, session expiry/revocation/deactivation, login throttling, audit rollback/immutability, Secure cookie policy and migration apply/repeat/revert.

Development migration applied once. A separate owner smoke test verified login, forced-change restriction, logout/revocation, bootstrap refusal on repeat, unchanged credential artifact and no-op repeated migration. Private-file ACLs were inspected. Dependency installation audit reported zero known vulnerabilities.

The original Documents copy is an earlier snapshot blocked by Windows Controlled Folder Access. Continue only in this D: workspace.
