# Engineering standards

Use feature modules under src/modules, infrastructure under src/infrastructure, shared configuration in src/config.ts until its size warrants a directory, migrations under src/database/migrations, operational commands under src/scripts. Keep HTTP controllers thin; business services own transactions and invariants; infrastructure implements persistence. No speculative empty modules.

All financial/stock writes require database constraints, transactions, authorization, audit and duplicate-request/concurrency tests. Never use floating-point money, automatic schema sync, production seeds or silent changes to posted history.

Configuration validates before connection. Separate runtime and migration credentials; no application superuser. Do not log URLs, passwords or raw SQL parameters. HTTP errors must not expose database details. Readiness differs from process liveness.

Commit exact direct versions and package-lock. Required gates: type check, build, unit/HTTP tests; database changes additionally require isolated PostgreSQL integration and compiled migration tests. A skipped DB test is pending, never a pass. Dependency warnings are triaged, not hidden with forced updates.

Document significant choices with reasons and acceptance gates. Keep current source-of-truth and validation limitations explicit. No enterprise-readiness claim before operational recovery and security verification.
