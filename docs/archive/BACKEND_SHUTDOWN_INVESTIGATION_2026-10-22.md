# Backend shutdown investigation

Audit date: 22 October 2026 (IST). No manually managed backend or preview was
started, stopped, signalled or restarted during this investigation.

## Finding: exact historical trigger remains unproven

The supplied PID 8616 output shows successful startup followed by normal Uvicorn
shutdown, application shutdown completion and return to a separate PowerShell
prompt. It contains no traceback or startup failure. This establishes a graceful
shutdown path, not who requested it. It is not evidence by itself of a project
cleanup bug, Ctrl+C, external process control or an application crash.

Evidence reviewed:

- Project application, backend/frontend verification scripts, tests and process-
  control references. No broad Python/Uvicorn kill command or shutdown endpoint
  was found. Frontend outage checks block/mock requests; they do not stop servers.
- The existing verifier's only server stop sets `should_exit` on the `server`
  object it constructed on a bound ephemeral socket. It does not find a PID by
  port/name, send a signal, call taskkill or stop an external process.
- Installed Uvicorn 0.54.0 source: `should_exit` and captured signals are instance
  fields. Its signal capture is skipped for the verifier's background thread.
  Thus the cleanup assignment is not a global flag shared with another process.
- PowerShell history has a historical explicit `Stop-Process -Id 28072`, matching
  the earlier replaced backend, not PID 8616. Old unrelated node/main process
  commands also exist. History has no per-command timestamps, so these entries
  do not establish the timing/cause of the reported shutdown. None were executed
  during this audit.
- No matching Windows Security 4689 process-exit events were returned for the
  queried six-hour window (`NoMatchingEventsFound`). PID 8616 was already gone;
  its signal sender/exit circumstances cannot be reconstructed from these records.
- No relevant Uvicorn request-limit/worker/reload environment override was found
  in the queried process/user/machine settings. No existing PowerShell profile
  process-cleanup hook was found in the inspected profile locations.

The earlier tool-policy rejections prevented the rejected commands from running;
they are not evidence that those commands stopped PID 8616. We do not attribute
the shutdown to the user, IDE, verifier or tool supervisor without further evidence.

## Controlled reproduction and hardening

New `backend/scripts/verify_server_isolation.py` starts a storage-free sentinel on
an OS-selected ephemeral port, runs the real workspace/profile verifier on a
different ephemeral port with temporary private stores, then checks the sentinel
again. The verifier finished and cleaned up its own instance; the sentinel
remained alive, answered health and had no captured signals. Only the sentinel
created by the reproduction was subsequently closed by that reproduction.

Observed reproductions used sentinel/verifier ports 55752/59396 and 57933/57937;
none used 8000, 8010, 5173, 5180 or 9222. Real market/auth files and the 54
snapshot schemas/checksums remained unchanged. No disposable accounts were added
to real storage. The preview listener remained the existing PID 39480.

The verifier now explicitly refuses reserved service ports and prints its own
PID/ephemeral port. Cleanup remains instance-local. This is defensive hardening,
not a claim that a previously identified cross-process cleanup bug was fixed.

## Single diagnostic startup

New `backend/scripts/run_local_backend.py` runs the same FastAPI app through
Uvicorn and records lifecycle-only evidence in ignored
`backend/logs/backend_lifecycle.jsonl`:

- UTC timestamp, run UUID, own PID and parent PID.
- Port, configured request limit and workers at startup.
- Received SIGINT/SIGBREAK/SIGTERM names when Uvicorn handles them.
- Shutdown start/finish, captured signal list, final server state and exception
  type if startup/run raises.

No request contents, credentials, session tokens, notes, stack traces or personal
filesystem paths are logged. Existing Uvicorn handling is delegated unchanged.
The launcher neither enumerates nor stops other processes and has no cleanup by
port/name. An occupied port simply fails normal startup rather than stopping its
owner. The normal app startup command is unchanged; this launcher is opt-in.

Interpretation: a recorded signal identifies the immediate shutdown trigger,
but Windows/Python does not provide the sender PID in this handler. A shutdown
without a signal is recorded separately. An abrupt end with no final event
requires external process/console evidence; absence of an event alone does not
identify a killer. The launcher cannot retroactively explain PID 8616.

After this audit, start the backend **once** in a separate PowerShell window and
leave that window open:

```powershell
Set-Location 'C:\Desktop\Auraxis\backend'
.\.venv\Scripts\python.exe scripts/run_local_backend.py --port 8010
```

Leave preview running. Subsequent checks should be read-only against 8010; all
mutable verification remains on owned ephemeral servers and disposable storage.
If it exits again, inspect the matching run's lifecycle events before any restart.

## Verification

```powershell
# From backend:
.\.venv\Scripts\python.exe scripts/verify_server_isolation.py
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check ..
.\.venv\Scripts\ruff.exe format --check ..
```

The isolation reproduction and the focused lifecycle tests passed. The
reproduction also exercised real HTTP profile/workspace flows with temporary
storage and validated the 54 existing snapshots. The lifecycle recorder correctly
distinguished the sentinel's instance-local cleanup from a received signal.
Log-write failures also preserve normal Uvicorn signal handling without printing
the private exception text. Full-suite results are recorded in the handover after
completion. Final results: **233 backend tests passed**, including all three
lifecycle tests; repository Ruff and formatting checks passed, as did
`git diff --check`. The final isolation run used sentinel/verifier ports
62790/62794 and again left the sentinel alive until its own explicit cleanup.
Real market/auth/workspace hashes remained at their Phase 4 baseline. Preview
remained PID 39480 on 5173; nothing was listening on 8010 when the audit ended.
Frontend code, analytics and market data were not changed. No commit, push or
deployment.

## New captured shutdown: PID 36528

The subsequent diagnostic run recorded startup at 16:29:15 UTC and receipt of
**SIGINT at 16:29:20 UTC on 22 October 2026** (21:59:20 IST), about 5.5 seconds
after startup. Shutdown started with `should_exit=true` and captured `SIGINT`,
then completed. The recorded request limit was null and workers was 1.

This identifies the immediate trigger as an interrupt signal, not a request-limit
shutdown. It does **not** identify the signal sender or prove the user pressed
Ctrl+C. The separate earlier PID 8616 has no corresponding lifecycle trace, so
its trigger is still not independently proven. No backend/preview was stopped
to obtain this evidence.

The visible CancelledError/KeyboardInterrupt traceback came from the diagnostic
launcher's re-raising of Uvicorn's replayed interrupt after graceful shutdown.
The launcher now records `run_interrupted` and exits with conventional status 130
without that traceback. Signal handling is retained; this fixes noisy diagnostic
exit reporting, not the unidentified source of SIGINT. A focused test verifies
the exit code, retained signal evidence and absence of traceback output.

The user subsequently confirmed no Ctrl+C, copy shortcut, Stop action or terminal
interaction during this run. Manual keypress must therefore not be assumed.
Read-only follow-up found no matching Auraxis/Uvicorn/Python-stop action in the
accessible scheduled-task list. PowerShell Operational/classic event queries for
16:29:14–16:29:24 UTC returned `NoMatchingEventsFound`; they do not identify a
sender. Running-process names/parent IDs alone also do not attribute the exited
process's SIGINT. No scheduler/system settings were changed and no processes were
stopped. The signal source remains unresolved; no application fix is claimed.
