# Local database setup

## Current state

Setup completed on 8 November 2026 through the saved pgAdmin administrator connection. Both dedicated databases and four generated accounts passed login/access checks. Do not rerun setup SQL or automatic provisioning on this installation.

.env contains development runtime/migration credentials; .env.test contains the test equivalents. These and .env.setup/.local-setup are ignored by Git. Do not print credentials or replace the generated files with examples.

Routine verification:

```powershell
npm run db:verify-local
npm run test:database
```

The first command checks both databases and all four roles without schema changes. The second compiles and exercises migrations against commerce_platform_test only. Temporary probe tables are reverted; the migration-history table remains. Existing business databases are not targets.

## Provisioning a new local installation

Use either the automatic administrator route (db:check-admin then db:provision-local) or prepare-local-sql.mjs with a saved pgAdmin connection. Both refuse existing local credential files. Exported SQL files must run separately in numerical order, with Auto-commit for CREATE DATABASE. They refuse existing commerce role/database names. Stop on error and inspect partial state; never overwrite generated credentials or drop data to make setup pass.

The .env.setup administrator password was not accepted by the server. Application development no longer depends on resolving it: the new accounts have independently generated credentials. Do not reset PostgreSQL authentication or enable trust mode.

Structure: src/infrastructure/database for connectivity, src/database/migrations for explicit business schema changes, src/scripts for operational commands, test/database.integration.ts for compiled migration/access tests. Application startup never runs migrations automatically. Remote/TLS deployment support remains pending.
