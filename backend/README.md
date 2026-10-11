# Auraxis backend

FastAPI project scaffold for the MCX gold futures research dashboard. Requires
Python 3.11 or newer. The initial environment was created with Python 3.14.
Only the health endpoint is implemented. Data and analytics packages are placeholders;
the SQLite URL and cache path are configuration only.

## Set up (PowerShell)

From the repository root:

```powershell
Set-Location backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Select a specific installed interpreter with `py -3.11` or `py -3.14` if needed.
If PowerShell blocks activation, allow scripts for this session and retry:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Edit `.env` to change settings. `pydantic-settings` reads `backend/.env`, and
environment variables take precedence. `CORS_ORIGINS` is a comma-separated list;
the default frontend origins are `http://localhost:5180` and `http://localhost:5173`.
Settings are cached; restart the server after changing `.env`.

Only the requested top-level packages are installed, along with their required
dependencies. `requirements.txt` pins the installed packages and dependencies.
Uvicorn uses its base install without optional extras.

Settings use `BaseSettings`, `SettingsConfigDict`, and `NoDecode` with a
comma-splitting validator, following the
[official pydantic-settings documentation](https://docs.pydantic.dev/latest/concepts/pydantic_settings/).
The health test uses HTTPX's documented
[ASGI transport](https://www.python-httpx.org/advanced/transports/#asgi-transport)
with standard-library `asyncio`, avoiding the installed Starlette version's
deprecated HTTPX `TestClient` integration and any additional test libraries.

## Run (PowerShell)

From `backend`, with the virtual environment activated:

```powershell
uvicorn app.main:app --reload --port 8000
```

In another PowerShell terminal:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

Expected JSON: `{"status":"ok","app":"Auraxis"}`. Stop the server with Ctrl+C.

## Verify and format (PowerShell)

From `backend`, with the virtual environment activated:

```powershell
python -m pytest
ruff check .
ruff format --check .
```

Apply formatting when needed:

```powershell
ruff format .
```

The cache contents and `.env` are ignored by Git; `data_cache/.gitkeep` is preserved.
