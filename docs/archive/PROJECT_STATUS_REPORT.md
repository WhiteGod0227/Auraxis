# Auraxis — Implementation and Next Steps Report

**Report date:** 30 October 2026
**Current classification:** Functional local research prototype with a guided hackathon demo. Public deployment and production acceptance remain pending.

This report consolidates implementation and recorded verification. A fresh local run on 30 October passed 247 backend tests, 126 frontend tests, build/lint checks, 49 browser checks and six-route offline/recovery acceptance. See [the dated acceptance handoff](LOCAL_ACCEPTANCE_2026-10-30.md) for exact scope and untested deployment requirements.

## 1. Project overview

Auraxis is a historical research dashboard for four MCX gold futures products: GOLDM, GOLDTEN, GOLDGUINEA and GOLDPETAL. It converts quote quantities to a common basis, compares fixed expiries, explains calculations, and runs settlement-based simulations with costs and position reporting.

The frontend uses React, TypeScript and Vite. The backend uses FastAPI, pandas/NumPy and separate SQLite stores for market data, accounts and private research. It is not a live trading or order-execution platform.

## 2. Implemented features

| Area | Implemented behavior | Important boundary |
| --- | --- | --- |
| Landing and overview | Historical reference charts, product cards, navigation and research entry points | Historical observations, not live quotes |
| UI design | Minimal dark liquid-glass styling, compact navigation, shared surfaces and responsive controls | Sampled browser checks do not certify every device |
| Navigation and loading | Sidebar controls, mobile focus containment, Escape/focus return, scroll locking and inline loading states | Loading individual datasets no longer blocks the whole page |
| Relative Value | Normalized spreads, historical statistics, expiry selection, quality flags and optional maturity matching | A price gap is not proof of executable arbitrage |
| Calculation explanations | Comparison explanations and source/calculation traces when returned by the data source | Older snapshots can lack traces; missing evidence stays unavailable |
| Term Structure | Expiry curves and approximate fixed-contract roll-down diagnostics | Roll-down is model-based, not proven mispricing |
| Backtest | Supported same-expiry pairs, configurable costs, fractional/integer sizing and trade/position reports | Settlement-based simulated fills; realized, open and unresolved results remain distinct |
| Data ingestion | Manual permitted CSV loading, validation, idempotent market-row updates and ingestion diagnostics | No automatic MCX downloading or access-block bypass |
| Data Health | Recorded ingestion statuses, row-quality and volume diagnostics | Successful import does not establish complete market coverage |
| Coverage calendar | Product/date filtering and observed-data details | No authoritative holiday or expected-contract roster integration |
| Methodology | Formula/assumption disclosures and contract-source references | Full economic comparison validity remains unresolved |
| Guided demo | Compare → explain → inspect costs → save/reopen research, retaining the chosen common expiry | Uses actual results, including zero completed trades or missing data |
| Saved research | Private configuration CRUD, notes, ownership and revision protection | Results recalculate when reopened; numerical outputs are not frozen |
| Accounts and profile | Signup/login/logout, cookie sessions, name editing and account display | Registered email is not verified ownership |
| Password changes | Current-password confirmation and revocation of all sessions after a change | Requires a functioning backend |
| Authenticator MFA | Manual-key enrollment, confirmation, login enforcement, expiry and replay checks | Protect the private database containing recoverable MFA seeds |
| Offline account recovery | Eight single-use recovery codes, hash-only code storage, regeneration and password reset | Users must have saved codes beforehand; this is not email recovery |
| Historical Alerts | Up to 20 browser-local threshold rules, explicit expiry handling, persistence and unavailable states | Checked on page open/refresh; no live or closed-browser monitoring |
| Account alert sync | Explicit browser/account merges, cross-browser restoration, owner isolation and revision conflicts | Syncs rules, not notifications; no automatic upload of browser rules |
| Local offline fallback | Exact existing snapshot configurations during transport outages | Custom settings and HTTP errors do not silently receive default data |

### Main local routes

| Route | Purpose |
| --- | --- |
| `/app/demo` | Guided presentation workflow |
| `/app/relative-value` | Comparisons and explanations |
| `/app/term-structure` | Curves and roll-down |
| `/app/backtest` | Simulation and position reports |
| `/app/alerts` | Historical alert rules and explicit account sync |
| `/app/research` | Saved private research |
| `/app/profile` | Profile and security entry point |
| `/app/security` | Password, authenticator and recovery-code controls |
| `/app/recover` | Saved-code password recovery |
| `/app/data-health` | Ingestion and quality diagnostics |
| `/app/calendar` | Observed data coverage |
| `/app/methodology` | Assumptions and limitations |

The configured local preview is `http://localhost:5173`; backend health is `http://localhost:8010/health`. These are local URLs, not public deployment URLs.

## 3. Verification completed

| Check | Last recorded result | What it establishes |
| --- | --- | --- |
| Backend pytest | **247 passed** | Automated regression coverage, including new security and private-alert APIs |
| Frontend tests | **126 passed** | Client validation, routes, request behavior, saved settings and account-state handling |
| TypeScript / production build | Passed | Frontend compiles and produces build assets |
| ESLint | Passed | Frontend lint checks |
| Backend Ruff lint/format | Passed | Backend lint and formatting checks |
| Guided demo browser checks | Passed | Steps, expiry retention, explanations, save/reopen integration and failure/recovery behavior |
| Alerts browser checks | Passed | Add, duplicate prevention, persistence, removal, storage failures, local offline fallback and recovery |
| Real isolated security browser checks | Passed | Signup, MFA enrollment, recovery-code login, password reset with MFA preserved, and account-alert save/reload/restore |
| Focused layout checks | Passed at 1440, 390 and 320 px | Sampled desktop/narrow viewport behavior; no recorded runtime exceptions in completed runs |
| Local HTTP smoke check | 24 public reads at concurrency four succeeded; private/origin guards passed | Bounded local behavior, not sustained production capacity |
| Data-free deployment package | Passed; 18 files in the check artifact | No CSVs, databases or snapshots included; artifact marked DO NOT PUBLISH |

Private browser security verification used disposable backend stores on port 8011, with private requests redirected to that test service. It did not change real account settings. The verification-owned service was stopped afterward.

The fresh backend run emitted non-fatal Starlette/httpx deprecation and local pytest-cache write warnings. A clean test suite does not establish exhaustive correctness, production security, WCAG compliance or profitability.

## 4. Deployment and presentation preparation

**Prepared locally:**

- FastAPI Dockerfile and Railway configuration.
- Same-origin Nginx/frontend/backend Compose configuration.
- Required environment-variable examples and private persistent-store paths.
- Secure-cookie/HTTPS configuration guidance.
- Deployment packaging that excludes market data and preserves local exports.
- Hosted acceptance checklist and exact infrastructure requirements.
- Three-minute presenter script and user-interview worksheet.
- Private 42-second, silent, captioned WebM backup, verified at 1280×800 with playback/seek checks.

Recording: `deployment-private/demo-backup/auraxis-demo.webm`. It contains local historical market displays and must remain private until applicable publication permission exists. The recording shows signed-out Save honestly; it does not simulate completed private saving.

**Not completed:** public deployment, Linux container execution, hosted browser acceptance, persistent-volume acceptance or public HTTPS/session verification. No hosting account, domain or public backend URL has been provisioned. No paid resources or public uploads were created.

## 5. Known limitations and remaining problems

### Data and research

1. The current real dataset covers only **14 sessions, 14 September–1 October 2026**. It has not been extended or replaced with fabricated history.
2. Market-data redistribution permission is unresolved. Raw files, databases, snapshots and the recording must not be published without appropriate permission.
3. Official specifications confirm different quoted-price locations: GOLDTEN/GOLDGUINEA use Ahmedabad; GOLDPETAL uses Mumbai. Converting to rupees per 10 g does not remove that location basis. The app now explains this.
4. Full quote-price equivalence, delivery/fee/tax/margin treatment and executable liquidity remain unverified. Purity adjustment remains off by default; enabling it is experimental.
5. Short samples, settlement execution assumptions and unfinished positions do not establish profitable strategies or proven arbitrage.

### Accounts and infrastructure

6. Email verification and email-based reset links are not implemented/configured. No delivery provider or sending domain is available.
7. MFA seeds are stored recoverably in the private auth database. The local application does not encrypt the SQLite file. Hosted disk/backups and administrative access must be protected appropriately.
8. Saved-code recovery cannot recover an account if the user has neither valid login access nor previously saved codes.
9. Live feeds, background workers, email/push notifications and production edge rate controls remain pending. Account alert sync does not provide those services.
10. SQLite is configured for the current single-worker/replica prototype; high-concurrency/multi-instance operation has not been established.
11. The deployment package excludes snapshots. Hosted offline analytics therefore must not be promised unless a separately approved data package is introduced.

### Acceptance and product evidence

12. Docker/Linux startup, hosted persistence, backup restoration, TLS/cookies and rollback acceptance remain unverified.
13. Sustained-load, penetration testing, comprehensive cross-browser/physical-device checks and accessibility certification remain incomplete.
14. No user interviews, measured time-saving results or validated market demand have been recorded. No one has been contacted.
15. An account-deletion UI is not implemented. It is a separate follow-up feature rather than evidence that existing authentication is incomplete.
16. Source checkpoint/push status is recorded in Git history and the release handoff. Source publication does not deploy the service or publish the private data package.

## 6. What to do next — priority order

| Priority | Task | What you need to provide/do | Completion criterion |
| --- | --- | --- | --- |
| 1 | Rehearse and review the local product | Follow the guided demo; use your own account to review security and alert sync; save recovery codes privately if enabling MFA | A complete, understandable presentation without improvised claims |
| 2 | Checkpoint the implementation | Review code, documentation and the working tree before committing; keep private data/secrets ignored | A reviewed source-only commit that can be restored |
| 3 | Resolve data usage and expand history | Obtain permission covering the intended use and additional permitted CSVs; keep originals private | Audited longer coverage with documented provenance and limits |
| 4 | Select hosting | Provide authenticated hosting access, accepted costs, persistent storage and HTTPS/domain routing | A chosen topology with actual assigned URLs and private-store configuration |
| 5 | Validate containers and deploy | Supply a Docker-capable environment; build/start the prepared images and run the hosted acceptance checklist | Verified persistence, sessions, routes, TLS, restart and rollback behavior |
| 6 | Add email identity workflows | Choose a delivery provider and sending domain; configure secrets privately | Tested ownership verification and expiring, single-use email-reset flow with anti-abuse controls |
| 7 | Validate usefulness | Recruit three to five consenting target users and run the worksheet tasks | Actual completion/confusion observations and prioritized feedback |
| 8 | Consider live alerts | Obtain an authorized data provider; choose worker and notification delivery infrastructure | Documented freshness, retries, deduplication, delivery and monitoring behavior |
| 9 | Complete production hardening | Review encrypted storage/backups, load limits, accessibility, browsers and security controls | Recorded acceptance results appropriate to the intended audience |

Do not paste credentials into chat. Configure secrets through the chosen host or private local configuration. Do not publish the real dataset while permission remains unresolved. No external blocker should be marked complete solely because a configuration file exists.

## 7. Readiness assessment

**Local hackathon demonstration:** functional, with substantial implemented analytics and a guided workflow. Rehearsal and an honest explanation of the sample/assumptions are still necessary.

**Public deployment:** prepared in code, not deployed or accepted.

**Production service:** not certified; infrastructure, operational and security acceptance remain outstanding.

**Hackathon winning potential:** cannot be established from code completion alone. The next evidence should be a clear problem/benefit story, credible data, user feedback and a reliable presentation. No ranking or winning guarantee is claimed.

## 8. Supporting documents

- [README and local setup](../README.md)
- [Completion checklist](REMAINING_WORK_CHECKLIST.md)
- [Security and account-alert sync](ACCOUNT_SECURITY_AND_SYNC.md)
- [Historical Alerts](ALERTS.md)
- [Deployment configuration and requirements](DEPLOYMENT.md)
- [Contract-basis source review](CONTRACT_BASIS_REVIEW_2026-10-28.md)
- [Presenter script](HACKATHON_DEMO.md)
- [User-validation worksheet](USER_VALIDATION.md)

These documents describe different scopes. Historical audit counts should be read with their dates; the consolidated counts above reflect the latest recorded verification.
