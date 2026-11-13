# Completion checklist — 30 October 2026

Fresh results and scope: [30 October local acceptance](LOCAL_ACCEPTANCE_2026-10-30.md). Backend 247, frontend 126 and browser 49 checks passed; six public routes passed offline/recovery. Public deployment remains untested.

## Completed locally

- [x] Account-synced alert rules, ownership/revision protection and explicit merges.
- [x] Password changes, manual authenticator MFA and offline recovery-code password resets. Email delivery/verification remain pending.
- [x] Real isolated browser signup/MFA/login/recovery/account-alert verification and mobile checks.

- [x] Minimal glass UI, navigation and loading fixes.
- [x] Four-step guided demo with applied settings, source dates and Save/reopen integration.
- [x] Historical research Alerts replacing the placeholder, including local persistence and failure handling.
- [x] Contract-unit/location source review and visible location-basis caveat. Full economic equivalence remains unverified.
- [x] Data-free deployment packaging, FastAPI/private-volume settings and same-origin proxy configuration.
- [x] Presenter script, interview worksheet and repeatable browser checks.
- [x] Private 42-second captioned WebM backup at `deployment-private/demo-backup/auraxis-demo.webm`; decoded and seek-tested at 1280×800. Silent walkthrough of actual local screens; signed-out Save is not simulated as completed. Nothing published.
- [x] Frontend production build/lint, 126 frontend tests, 247 backend tests and backend Ruff/format checks.
- [x] Local read-only HTTP smoke test: 24 requests at concurrency four; private access denied and foreign origins rejected. Not production load certification.
- [x] Focused Chrome demo and Alerts checks, including mobile, local offline fallback, recovery and private-flow test interception.

## External work intentionally pending

- [ ] Email provider/domain setup for ownership verification and email-based recovery.
- [ ] Authorized live data provider and notification delivery/worker infrastructure.
- [ ] Hosted encrypted-disk, sustained-load, penetration and public acceptance testing. Local bounded checks do not certify these.

- [ ] **Hosting/deployment:** owner-authenticated hosting, accepted costs, HTTPS/domain and persistent disk are unavailable. No resources created.
- [ ] **Container execution:** Docker-compatible build/runtime is unavailable; Linux image build, proxy startup and persistent-volume acceptance remain unverified.
- [ ] **Longer real dataset:** obtain additional permitted files and applicable usage rights; current history has not been extended or fabricated.
- [ ] **Public market data:** permission is unresolved; no CSVs, databases, snapshots or recording are published.
- [ ] **User interviews:** consenting participants and actual observations are unavailable. Nobody contacted and no results invented.
- [ ] **Full economic certification:** contract locations/units checked, but execution/fees/delivery/price-basis equivalence need further evidence.

See `DEPLOYMENT.md` for exact environment/account requirements. Existing local services must remain in place.
