# Employee onboarding and first activation

Schema 21 adds owner-created, non-owner employee accounts and one-time first activation. This is not public self-registration, password recovery, owner enrollment/transfer or a live internet deployment. No employee account is automatically created in development.

## Owner and employee flow

Team > Employee onboarding > Add employee account asks for display name, a unique login username, reason and the current owner's password. The authenticated owner is determined by the session, not by an actor or role supplied in the form. New accounts receive no roles, no session and no usable shared password. The pending password marker cannot pass normal password verification.

The owner receives a random 256-bit activation code once. The code is hidden by default, bound to the named recipient and copyable for private manual delivery. Switching records is disabled while an un-copied code is displayed. Closing, clearing or losing the view removes that client copy. It is never stored in local/session storage, URL/history, an email queue, audit metadata or the idempotency response. Only its SHA-256 digest is stored in the private onboarding record.

Give the employee the username, activation-page address and code privately. Assign only required roles/location scopes through Manage team access, preferably before activation. The employee opens /admin#activate, supplies username/code and chooses their own password. A signed-in user must sign out before activating a different account. Successful activation requires ordinary sign-in afterward, with a fresh session. Activation itself sets no cookie or automatic login. The owner does not receive the employee password.

The same existing NFC normalization, 15-128-character password policy and salted scrypt profile apply. Owner reauthentication and employee hashing share the Identity module's bounded PasswordService instance; no new crypto library is installed. No automatic employee role or owner permission is granted. A prepared role becomes usable only after first activation and normal authentication; subsequent role changes retain existing session-revocation semantics.

## Code lifetime, lost responses and revocation

A code expires after 24 hours and is single use. The server clock is authoritative at final consumption, including after hashing. Reissue requires fresh owner password confirmation, the current onboarding revision and an active account. It replaces the digest and invitation identity so old codes fail. Revoke clears a pending digest. Existing activated accounts and legacy accounts are not valid reissue/reset targets.

Creation/reissue retries are intentionally different from password retrieval: concurrent identical requests record one action and only its first successful response contains the generated code. A cached replay rechecks authority but returns no secret, even to the original owner. If that response was lost, explicitly issue a new code. Different bodies or owners cannot reuse the same key. The UI reloads current state; cached responses describe historical actions rather than current eligibility.

Disabling a pending account through schema-20 access management revokes its activation in the same transaction. Reactivating the account cannot resurrect that code. An old cached deactivation reply also cannot revoke a newer code; the wrapper performs no extra mutation on replay. Activated passwords remain outside this invitation workflow.

Token entropy, digest-only storage, expiry, single use and bounded attempts follow the principles in [OWASP's token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). This implementation applies those principles to initial enrollment; it does not claim to implement account recovery. Owner password confirmation follows [OWASP's sensitive-action reauthentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). Password reauthentication is not MFA; MFA/step-up policy remains a separate production gate.

## HTTP and authorization

- GET /api/v1/staff-onboarding?search=&page=1 and GET /api/v1/staff-onboarding/:id?page=1 are owner-only, paginated private views. They return status, expiry, identity and versioned history, never code/digest/password/session data.
- POST /api/v1/staff-onboarding takes create/reissue/revoke, staff ID, expected onboarding revision, reason, identity fields only for create, and ownerPassword. Staff session, global staff.manage, actual active/onboarded global owner status, Origin/JSON/CSRF and current password confirmation are mandatory.
- POST /api/v1/auth/activate is the separate anonymous capability endpoint. It accepts username, code and newPassword. Origin, request-type and size protections still apply. Token/account failures use one generic invalid-or-expired response. Valid input is checked before expensive hashing, and the database rechecks the token/account/expiry again atomically before changing credentials.

Owner actions are bounded to 10 attempts per 15 minutes per owner, including successful actions. Anonymous activation is bounded to 30 attempts per 15 minutes per direct client IP and 15 per username. Counters use hashed namespace keys, do not permanently lock accounts, and recover after their window. Bulk onboarding, edge/proxy-aware abuse controls and counter retention need their own production review; do not simply trust forwarded client-IP headers.

Owner credential hash and the calling session are rechecked under database locks at issue time, so logout, password change or session revocation during verification cannot authorize a stale operation. Accepted, disabled, expired, revoked, malformed or owner-promoted pending accounts cannot consume a code. Deactivation/grant changes remain authoritative for subsequent authentication; these controls do not undo completed work or guarantee cancellation of in-flight requests.

Activation addresses use configured STAFF_ORIGIN plus a fixed fragment, never an untrusted Host header and never a token query string. All responses are no-store. There are no outbound messages, email credentials or hosting purchases. Current localhost URLs work on the development computer; remote employees need the separately configured HTTPS deployment.

## Persistence and compatibility

Migration 21 adds current onboarding state, immutable events and minimal request responses. It wraps the schema-20 access mutation to invalidate pending activation on account disable without rewriting prior snapshots or caches. Direct runtime execution of the renamed private v20 helper is revoked. Definer functions fix search_path, qualify relations and revoke PUBLIC execution. Runtime has SELECT plus narrow function execution; raw onboarding-table mutation remains denied.

Owner issuance and public consumption serialize with existing access mutations. Account creation/password change, code state/version, session revocation, event, audit and replay result commit together. An audit failure rolls back every associated effect; retry cannot leave an orphaned account or consumed code. Current records have explicit state/digest/activation-time constraints. No plaintext code/password is copied into history or request hashes. Safe request hashes exclude the generated digest and current-owner password.

Legacy users, credentials, roles, grants, scopes, business records and existing content fingerprints are unchanged by the migration. Team displays awaiting/expired/revoked activation distinctly from ready accounts. Existing employee password change remains available after normal sign-in. Empty-schema down/reapply is tested; any retained enrollment/history prevents destructive downgrade. Run npm run onboarding:verify-local for aggregate counts and history/pending-account invariants without private content.

## Verification and remaining gates

Verification combines 62 database-free/interface checks, the complete prior PostgreSQL regression suite and 17 focused onboarding checks. Coverage includes fresh owner/session/password authority, Origin/CSRF/default deny, direct SQL denial, concurrent creation/consumption, secret-free caches/audits/views, expiry/reissue/revoke, deactivation replay safety, no automatic login, personal-password verification, initial roles, least privilege, throttling, audit rollback of creation and sessions, and migration credential preservation.

A schema-20 database backup was restored on an isolated loopback PostgreSQL server with all 72 table/sequence fingerprints matching. Development advanced once to schema 21 with all 64 existing data-table fingerprints and existing permission metadata unchanged; repeated migration was a no-op. No real employee, password, grant or session was altered by this cutover.

Disposable browser acceptance exercised owner creation, password confirmation, hidden recipient-bound code display, replacement and revocation/history. Employee activation controls and the already-signed-in boundary were inspected at 390px; actual password establishment, normal sign-in and prepared-role enforcement were verified over real HTTP/PostgreSQL in integration tests. No real employee credential was entered through automation. Test accounts/codes/sessions were removed afterward. A final spacing refinement keeps the employee activation card padded within its responsive box.

New staff onboarding is now implemented; secure recovery, MFA, owner transfer, verified delivery policies, monitoring/retention, production TLS/proxy/rate controls and operational deployment remain launch work. The public storefront, video, controlled catalog facets, checkout and payment/fulfillment phases retain their separate acceptance gates. This is a local development increment, not a production-readiness claim.
