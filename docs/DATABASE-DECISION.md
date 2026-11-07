# Database foundation decisions — 8 November 2026

TypeORM 0.3.31 was evaluated first; audit found three moderate findings through glob/minimatch. Selected stable TypeORM 1.1.2 after checking runtime requirements and TypeScript declarations. pg 8.23.1 is pinned. Installation audit then reported zero known vulnerabilities. This supersedes the initial plan's 0.3 preference.

## Access and migrations

Both commerce_platform_dev and commerce_platform_test were provisioned through saved pgAdmin access, with separate non-superuser migration/runtime roles. All four logins and cross-environment connection denial were verified. Direct administrator password authentication remains unresolved and is no longer a development blocker.

The migration factory registers explicit migration classes so compiled JavaScript discovers the same schema changes. Schema synchronization and automatic startup migrations remain disabled. Runtime and migration credentials never fall back to each other. Current connection policy permits local PostgreSQL only; remote TLS deployment remains pending.

Reviewed migrations are applied by db:migrate. Runtime grants are an explicit follow-up transaction after schema migration; failure leaves readiness unavailable. Runtime cannot create schema objects, read migration history or update schema revision. Table grants are explicit: password columns only for staff updates, session/rate operations as required, and append/read only for audit. No blanket future-table grants or runtime DELETE/TRUNCATE rights.

The identity migration adds staff users, roles/permissions/location assignments, sessions, login counters, audit and an application schema-revision marker. Permission codes and the owner role are versioned reference data; no public user or default password is seeded.

## Runtime

A lifecycle-managed application DataSource powers the API. Startup initializes only DATABASE_URL and verifies the expected schema revision. Failure cleans up and aborts startup with a sanitized error. Shutdown marks readiness unavailable and destroys the pool. A closed or failing pool returns HTTP 503 readiness without exposing details; liveness remains independent.

## Verification and state

14 database-free tests and 15 reported PostgreSQL integration checks passed. The integration suite covers compiled migration apply/no-op repeat/revert, transactional rollback, runtime schema/history denial, real runtime failure/recovery/cleanup, staff authentication, CSRF, scope isolation and audit immutability/rollback. Identity up/down also passed inside an isolated scratch schema and rolled-back transaction.

The development identity migration and one-time owner bootstrap completed. Owner credentials are in a private local artifact; first-use password change is mandatory. Repeated migration produced no changes, and repeated bootstrap refused without overwriting credentials. Existing business databases were never targets.

Production backup restore, operational monitoring, proxy/TLS configuration, session/counter retention and independent audit retention remain release gates.
