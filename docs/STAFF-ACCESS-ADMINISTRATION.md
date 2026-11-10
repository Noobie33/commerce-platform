# Staff access administration

Schema 20 implements a bounded R2 administration slice: owner-controlled custom roles, assignments and existing staff status. It does not create employee credentials, send invitations, reset passwords, change usernames, modify owner access or complete all staff onboarding.

## Workflow

Team > Manage team access opens paginated Staff access and Roles views. Role names are business-facing; the interface generates a stable unique internal code. Select only required permissions, with separate read and action grants. Several roles can combine to provide a staff member's complete access. New roles are not seeded in development.

Staff access edits display name, active status and a complete list of role/location assignments for an existing non-owner. Pick a role, then explicitly select one location or company-wide scope. The interface shows existing human-readable role/location labels. No role means no operational permission. Username and existing password remain unchanged.

Every change requires a reason and current revision. Expected revisions prevent stale saves. Immutable before/after history records the acting owner and revoked-session count without passwords, password hashes, cookies or session tokens. No hard delete or rewriting of staff/business history is introduced.

## Owner boundary and permitted scope

The existing staff.manage route permission does not itself confer access administration: a fresh active, onboarded global owner assignment is required in the database. Role writes additionally recheck global roles.manage, including before cached replay. Non-owner delegated administrators with these old permission codes are denied by this slice.

All owner accounts and the owner role are protected from editing, deactivation, assignment or removal in this screen. Reserved legacy administrative/retired-credit roles are read-only. Owner transfer, additional owner enrollment, MFA, recent reauthentication and recovery need their separately reviewed workflow; do not use this feature to bypass them.

The permission policy registry initially includes current permissions except staff.manage, roles.manage, customers.credit.manage and sales.price_override. This preserves historical metadata while preventing new administrative delegation or retired wholesale/credit/negotiated-price behavior. Newly introduced permissions must be explicitly registered by a future migration before custom roles can select them; absence fails closed.

Location-compatible permissions are locations.read; inventory.read/receive/adjust/transfer; purchasing.receive/reverse_receipt; and sales.reserve. A location assignment is valid only if every permission in the role supports location scope, and the location is active. All other assignable permissions require company-wide scope. A mixed global/local role cannot be slipped into a location assignment, nor can a location-assigned role later be expanded with global permissions. Combine an appropriate global read role with a scoped action role where the business workflow requires both.

Retiring a role requires removing all assignments first. A retired role has no grants and cannot be assigned. Reactivation does not silently restore old permissions: explicitly choose them again. Old definitions remain in immutable history.

## Sessions and immediate effects

Changing staff active state or assignments revokes that staff member's unrevoked sessions in the same transaction. Changing a role's actual grants revokes affected non-owner staff sessions; protected owners retain their separate owner access. A display-name or role-label-only edit does not revoke sessions unnecessarily. Deactivate/reactivate never resurrects an old revoked token. Existing authentication still checks current activation, grants, location boundaries and expiry on every request.

These controls stop subsequent authorized use; they do not undo completed actions or guarantee cancellation of requests already in flight. Real employee onboarding must establish a secure first-login and credential-delivery process before operational adoption. No password is issued or shared by this increment.

Owner management lists use authenticated live invalidation and recovery checks. Open edits/history pause reconciliation so unsaved decisions are preserved. Existing staff/role/permission triggers and new role-profile/revision triggers invalidate access-dependent views without publishing account details in notification payloads. Background reads do not renew idle sessions.

## Database and compatibility

Migration 20 adds the permission-scope policy, staff access versions, role profiles, immutable events and minimal idempotency cache. It does not backfill changes into users, passwords, role grants, scopes or active sessions. Existing migrations 1-19 and their fingerprints remain unchanged.

Restricted runtime has SELECT and narrow function execution for new resources, with PUBLIC execution revoked. Definer functions fix search_path and qualify relations. Owner access mutations serialize through a transaction advisory lock. Current authority, request body/actor identity, expected revision, protected owner rules, role/location compatibility, state changes, session revocation, event, audit and replay result are checked/committed together. Audit failure rolls all changes and session revocations back. Cached replies describe a historical action and do not bypass fresh authority checks.

The old Team directory remains available with its existing staff.read permission and first-100 directory presentation. The new owner administration views search and paginate the full staff/role set on the server, with separately paginated role/location choices and history. A broader non-owner directory refresh remains separate work.

Empty schema down/reapply is supported; populated access state/history prevents downgrade rather than discarding it. Run npm run access:verify-local after building for aggregate managed-staff/role/event counts and contiguous-history invariants, without private account content.

## Delivery gates

Required gates are strict types, full API/admin build, unit/interface and isolated PostgreSQL regressions, protected-owner and real scoped HTTP/session checks, audit rollback, migration preservation, disposable desktop/phone browser acceptance, a restore-verified pre-change database backup and unchanged existing development records. CI runs the aggregate verifier on its disposable database. Verification completed: 59 database-free/interface checks and 257 reported PostgreSQL checks passed, with a further final 13-check focused rerun. The audit test also confirmed that a failed staff deactivation leaves the active account, session, revision and retry key unchanged; retry succeeds only after the audit failure is removed.

A disposable browser flow verified protected owner access, custom warehouse-role creation without a user-entered code, location-specific staff assignment, the resulting old-session revocation and human-readable saved role/warehouse labels. The 390px phone layout saved staff deactivation and displayed history without page/dialog/control overflow. An initial role-form validation issue found during browser acceptance was fixed and the flow repeated successfully. Test staff, roles, sessions and the warehouse were removed afterward.

A schema-19 database backup was restored to an isolated loopback PostgreSQL instance with all 67 table/sequence fingerprints matching. Development advanced once to schema 20 with all 59 prior data-table fingerprints and existing permission metadata unchanged; repeat migration was a no-op. No real account, password, session, role grant or location assignment was altered by the cutover. Main readiness, /admin and linked/lazy team/access assets returned 200.

No dependency, email service, hosting purchase or real employee account is required for this slice. Secure employee activation/invitation, password recovery, MFA/step-up policy, owner-transfer controls and operational access review remain launch work. This is a verified local development increment, not production readiness.

## Schema 21 follow-up

[Secure employee creation and first activation](EMPLOYEE-ONBOARDING.md) now complement these access controls. New employees start without roles or a shared password. Disabling a pending employee also revokes the pending activation atomically; a cached access retry cannot invalidate a newer invitation. Recovery, MFA and owner transfer remain separate gates.
