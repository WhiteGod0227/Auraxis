# Account security and alert sync — 28 October 2026

## Implemented

- `/app/security`: current-password confirmation, password changes, manual authenticator enrollment, MFA disable and recovery-code regeneration.
- `/app/recover`: password reset using a previously saved single-use recovery code. All sessions are revoked; configured MFA stays enabled.
- Login accepts an optional authenticator/recovery code. Users without MFA keep their existing login flow.
- `/api/alerts/rules`: authenticated private rule sets with owner isolation, maximum 20 rules, validation and optimistic revision checks. Stored in the existing separate workspace database.
- Alerts offers explicit browser-to-account merges and account-to-browser restoration. No automatic upload, silent overwrite, public snapshot fallback or cross-account reuse.

## Authentication behavior

Authenticator setup returns a fresh manual Base32 key (SHA-1, six digits, 30 seconds) and a provisioning URI. Setup is not active until a correct app code is confirmed within ten minutes. No seed is sent to an external QR service. Enabling MFA revokes other sessions and retains the current reauthenticated session so recovery codes can be saved. Password change and MFA disable revoke all sessions.

MFA login requires both the password and a fresh authenticator code, or password and an unused recovery code. Accepted time steps cannot be replayed. Recovery codes contain 128 bits of randomness each; only hashes are stored. Eight codes are displayed once. Regenerating invalidates the previous set. Codes can also reset a password; if MFA is enabled another unused code or the authenticator is still needed to log in afterward.

Sensitive mutations use the existing exact-Origin checks and persistent attempt limits. Invalid security fields are not echoed in responses. Private responses are no-store. Password verification and second-factor use share transaction checks that prevent an old-password login racing a reset. Account paths inside public/build output or aliased to workspace/market storage are rejected.

## Operational limits

Email ownership remains **unverified**. No SMTP/provider, verification email or email-reset delivery is configured. Offline-code recovery cannot help a user who never saved codes and cannot sign in.

MFA seeds must remain recoverable and are stored in the private auth database. Local code does not encrypt that SQLite file. Hosted deployment must protect/encrypt the persistent disk and backups, restrict administrative access and keep auth/workspace backups consistent. Never publish seeds, recovery codes, databases, screenshots of secrets or private logs. This is not a penetration-tested identity service.

Alert sync stores rules, not notifications. Live feeds, closed-browser jobs, email/push delivery and production edge limits remain pending external services.

## Verification

Final backend regression run: **247 passed**, with the existing non-fatal Starlette/httpx deprecation warning. Backend Ruff lint and formatting checks passed. Unsafe private-store paths preserve the existing HTTP 503 behavior.

Backend tests cover RFC 6238 SHA-1 vectors, enrollment, required second factor, time-step replay, setup expiry, recovery-code reuse/hashing, password/session changes, origin checks, throttling, storage-path isolation, alert ownership and revisions. Frontend tests cover private request behavior, stale-account response rejection, merging, security-response validation, routes and login-return paths.

`frontend/scripts/verify-security.mjs` exercises real browser signup/MFA/recovery/account alerts against `backend/scripts/run_security_qa.py` on 8011. The QA server uses disposable ignored private stores; private browser requests are redirected there before reaching 8010. It does not mutate real accounts. Stop the verification-owned 8011 server afterward.

`backend/scripts/verify_local_load.py` performs 24 read-only local HTTP requests at concurrency four and checks private endpoint/origin guards. This bounded smoke check does not establish public, sustained-load or adversarial security readiness.

Actual local results: 126 frontend tests, production build and ESLint passed. Real isolated browser checks passed for signup, MFA confirmation, recovery-code login, password recovery with MFA preserved, alert-rule save/reload/restore, and 1440/390/320 px layouts with no recorded runtime exceptions. A 24-request HTTP smoke check at concurrency four returned all HTTP 200s for public reads; signed-out private access and foreign-origin mutations were rejected. The test-owned 8011 service was stopped afterward. No real account settings were modified by the verification.
