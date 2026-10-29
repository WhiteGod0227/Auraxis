# Backend fixes — 28 October 2026

Completed the code-level fixes below and verified login/session/Profile behavior using isolated stores. Real accounts, market data, existing databases, snapshot payloads and user-managed services were preserved. No dependencies, commits, pushes, deployment or PPT work.

## Issue-by-issue status

| Item                                         | Status                             | Result / remaining requirement                                                                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unexpected SIGINT                            | **UNRESOLVED**                     | No new evidence identifies the interrupt sender. Signal handling was not suppressed, no user action assumed, and no automatic restart workaround added. Existing lifecycle evidence remains available. Successful isolated checks do not establish a fix. |
| MCX scripted HTTP block                      | **EXTERNAL LIMITATION**            | Downloader remains disabled. Authorized manual CSV loading remains the supported path. No bypass or live downloader attempt.                                                                                                                              |
| Short/outdated sample                        | **AWAITING AUTHORIZED DATA**       | Fourteen canonical files were parsed read-only; all passed. No newer data was supplied or fabricated.                                                                                                                                                     |
| Comparison/purity verification               | **PENDING SOURCE VERIFICATION**    | No analytics assumptions changed. Default purity OFF and experimental ON behavior remain; complete quoted-price equivalence is not claimed.                                                                                                               |
| Official calendar / expected contract roster | **AWAITING AUTHORITATIVE INPUT**   | Not inferred from missing dates. No fabricated holidays or completeness counts.                                                                                                                                                                           |
| Import-attempt history                       | **FIXED FOR FUTURE IMPORTS**       | Added append-only `ingestion_attempts` alongside the existing latest-per-file summary. Old history is not invented.                                                                                                                                       |
| Structured volume warnings                   | **FIXED FOR FUTURE IMPORTS**       | Added per-attempt contract/date warning records. Rows are still kept and the raw source volume text retained privately. API pages are bounded, with safe summaries and no raw exception notes.                                                            |
| Recorded import error                        | **DIAGNOSED; RETAINED**            | The `(1).csv` filename was rejected. Its canonical file exists and parses. The failed filename is not a missing gold session. See evidence below; historical error was not erased.                                                                        |
| Browser-copy handling                        | **FIXED CONSERVATIVELY**           | Loader CLI explicitly skips only byte-identical `(N)` copies when the canonical file exists. Differing files remain rejected. No source files renamed, deleted or overwritten.                                                                            |
| Missing creation timestamp                   | **FIXED FOR NEW ACCOUNTS**         | Actual UTC timestamp stored at signup in private `account_metadata`; Profile returns it. Legacy dates remain null, not guessed. Legacy login requirements, passwords, IDs, sessions and workspaces are preserved.                                         |
| Email verification/reset/MFA                 | **PENDING BY USER INSTRUCTION**    | Provider not configured. None is claimed working and none blocks existing login.                                                                                                                                                                          |
| SQLite scaling                               | **ARCHITECTURAL LIMITATION**       | Transactional imports and private flows verified locally; no distributed database migration or production-scale guarantee. Growth/retention planning is still needed for sustained use.                                                                   |
| Starlette/httpx warning                      | **PENDING DEPENDENCY MAINTENANCE** | Existing tests pass. Installed Starlette recommends `httpx2`; no package was installed and the warning was not hidden.                                                                                                                                    |
| Login documentation                          | **FIXED**                          | Normal login destination is Landing `/`; explicit allowlisted internal return routes remain supported. Current account-date behavior documented.                                                                                                          |

## Actual ingestion finding

The earlier statement that the cause of the one recorded import failure was unknown was inaccurate. Its local notes identify the strict filename rejection and the existing safe public summary supports that classification.

- `BhavCopyDateWise_01102026 (1).csv` does not match the required canonical filename.
- Both it and the canonical file contain 15,104 rows dated 1 October 2026.
- They are **not** byte-identical or identical parsed CSVs: 14,866 full-file rows differ.
- Their 24 selected gold FUTCOM rows, sorted by symbol/expiry, are identical.
- All fourteen canonical CSV files parsed successfully in a read-only audit.

The differing full file was therefore not automatically substituted or treated as an identical copy. Canonical gold observations were not missing. The old rejection remains an honest historical record; no user file or real database was changed merely to make an error count zero.

## Implementation and compatibility

- Loader appends attempt records, warning records, bhav upserts and latest file status transactionally. A simulated persistence failure rolls back successful-attempt evidence and market rows together, then records the failed attempt when persistence becomes available.
- `bhav` retains its original idempotent `(symbol, expiry_date, trade_date)` key. Reimports append attempts, not duplicate market rows. Warning totals are per attempt, not unique current observations.
- `/api/data-health` adds optional `ingestion_history` and `volume_mismatches` pages using `diagnostic_limit`, including counts, truncation and explicit legacy-unavailable states. Reads never create the new tables.
- Public history exposes fixed safe error summaries; local paths, raw exception notes and arbitrary malformed volume text are withheld. Existing aggregate diagnostics do not imply comprehensive row validation.
- Frontend types and validators accept and validate new pages while preserving old API responses/snapshots that omit them. No new visible frontend panels or redesign.
- New signups create an additive private metadata table; legacy user rows are not migrated/backfilled. Existing frontend already handles null or UTC creation dates. Name edits preserve the original timestamp.
- API semantics for old diagnostics remain accurate on old databases. Existing offline snapshot files were not regenerated or modified.

## Checks performed

| Check                                                          | Actual result                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Complete backend pytest                                        | **239 passed**                                                                                           |
| Focused backend fixes after strengthening legacy-password test | **5 passed**                                                                                             |
| Backend Ruff lint / format                                     | **PASS**, 53 files formatted correctly                                                                   |
| Complete frontend suite                                        | **109 passed**                                                                                           |
| Frontend lint / typecheck / production build                   | **PASS**                                                                                                 |
| Isolated real HTTP account/workspace verifier                  | **PASS**: signup/login, ownership/conflicts, CRUD, Unicode Profile update, session continuity and logout |
| Snapshot verifier                                              | **54 existing schema/checksum validations passed**, files unchanged                                      |
| Dedicated Chrome integration                                   | **5/5 PASS**, no runtime exceptions                                                                      |
| Real DB preservation                                           | **PASS**: market/auth/workspace SHA-256 values unchanged                                                 |

Dedicated Chrome used temporary profiles and private contexts, isolated backend 8011 and production preview 5181. The browser checked legacy login → Landing; undated legacy Profile edit and refresh; new UI signup with a displayed UTC date; unchanged date after name edit; actual frontend validation of new health evidence and old snapshots; logout clearing private Profile. Only synthetic test data was used. This focused browser pass does not repeat or replace the broader desktop/mobile acceptance from 27 October.

The integration assertion script also recognizes omitted optional diagnostic pages without ignoring analytics values or hiding new available evidence. Fresh live/offline equality against the updated server was not run on the user-managed 8010 instance because it remains the old process; isolated new-response validation and old-snapshot compatibility were performed instead.

Evidence and harnesses remain ignored under `backend/.tmp/backend-fixes-20261028/`. No credentials are included in this report or public snapshots.

Disposable database copies and the synthetic credentials file were removed after
verification. Real market/auth/workspace hashes were checked again and remained
unchanged.

During final review, additional frontend navigation/demo/deployment edits appeared
outside this backend work. They were preserved and not attributed to these fixes.
Current frontend lint/typecheck and all 109 tests were rerun successfully after
they appeared. The recorded production build and focused browser checks apply to
the backend-fix revision captured before those concurrent frontend edits; their
final visual/deployment behavior was not audited here.

## Running-service handover

Original backend **8010 / PID 16060** and preview **5173 / PID 41504** remain running. Verification services and the owned test browser were stopped. Real stores and market CSVs were not modified. The original backend process has **not** loaded these Python changes; it was deliberately not restarted.

At the next controlled restart, use the existing backend terminal: Ctrl+C once, then:

```powershell
Set-Location 'C:\Desktop\Auraxis\backend'
.\.venv\Scripts\python.exe scripts/run_local_backend.py --port 8010
```

Keep the terminal open. No second server should be started while that port is occupied. New import-history tables appear only on a subsequent deliberate loader run; new account metadata appears only on signup. Legacy creation dates remain unavailable. Do not reimport data solely to erase an old error record.

**Not completed:** original SIGINT attribution, externally blocked downloader, newer authorized market data, full contract-basis verification, official coverage sources, provider-dependent email features and production-scale/dependency maintenance. No claim that all backend limitations are solved.
