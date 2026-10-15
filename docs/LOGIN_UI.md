# Functional local accounts

Route: http://localhost:5173/login . Landing navigation includes Log in. The existing 3D flip, crow and background are preserved.

Signup creates a real local account and signs in; login verifies credentials and opens /app. The dashboard header shows the signed-in name and Sign out. Reload restores the session; sign out revokes it on the server. Authentication never falls back to offline snapshots. Existing research/demo routes remain public; accounts do not protect or privatize the public analytics/snapshots.

Account storage is separate: backend/auth.sqlite3 (Git-ignored), containing users, hashed sessions and attempt counters. Passwords use a random salt and PBKDF2-HMAC-SHA256 at 600,000 iterations. Sessions use random 256-bit tokens; only SHA-256 token digests are stored server-side. Cookies are HttpOnly, SameSite=Lax, with a fixed 24-hour expiry by default. No password/token localStorage/sessionStorage writes or credential logging. Email is normalized to lowercase; ownership is not verified.

POST account endpoints require an exact configured frontend Origin; credentialed CORS is enabled. Persistent local counters restrict signup per client IP and login per IP/email to five attempts per ten minutes. This is local prototype protection, not distributed abuse prevention. Validation responses do not echo credential inputs. Inactive form faces are inert; controls disable during submission and password fields clear after attempts.

Backend options (defaults work locally):

```text
AUTH_DATABASE_PATH=./auth.sqlite3
AUTH_COOKIE_SECURE=false
AUTH_SESSION_HOURS=24
```

Use localhost consistently. Secure=false is for local HTTP; future HTTPS hosting must enable it and persist the private auth database. SameSite=Lax does not support arbitrary cross-site frontend/backend hostnames: future hosting needs same-site HTTPS domains or a separately reviewed session/proxy design. No public authentication/deployment verification occurred.

Not implemented: email verification, password reset, MFA, account deletion UI or private research datasets. No production-security certification is claimed. Never publish the account database/environment files.

Checks: 178 backend tests (five new isolated authentication tests), 56 existing frontend tests, typecheck/lint/build, repository Ruff. Actual Chrome at 1440x1000 and 390x844 emulation verified real signup, wrong-password rejection, login, session after refresh, logout, HttpOnly cookie and mobile flip/fit. Evidence: docs/evidence/login-functional/checks.json and screenshots. The unique browser-test account was removed after logout; market data was preserved.

Official references followed:
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://fastapi.tiangolo.com/tutorial/cors/
