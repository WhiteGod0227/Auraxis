import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.alerts import router as alerts_router
from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.coverage import router as coverage_router
from app.api.data_refresh import auto_refresh_loop
from app.api.data_refresh import router as data_router
from app.api.foundation import router as foundation_router
from app.api.health import router as health_router
from app.api.live import router as live_router
from app.api.onchain import router as onchain_router
from app.api.practice import router as practice_router
from app.api.proofs import router as proofs_router
from app.api.security import router as security_router
from app.api.wallet import router as wallet_router
from app.api.workspaces import router as workspace_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.data import proofs as proofs_service
from app.data.live import service as live_service
from app.data.onchain import service as onchain_service
from app.data.watcher import watch_loop

setup_logging()
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    tasks = []
    if settings.upstox_access_token.strip() and settings.auto_refresh_hours > 0:
        tasks.append(asyncio.create_task(auto_refresh_loop(settings)))
    if settings.upstox_access_token.strip() and settings.live_poll_seconds > 0:
        tasks.append(asyncio.create_task(live_service.run(settings)))
    if settings.onchain_enabled:
        tasks.append(asyncio.create_task(onchain_service.run(settings)))
    if settings.proofs_enabled:
        tasks.append(asyncio.create_task(proofs_service.run(settings)))
    if settings.bhavcopy_watch:
        tasks.append(asyncio.create_task(watch_loop(settings)))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Auth-Step"],
)
app.include_router(health_router)
app.include_router(foundation_router)
app.include_router(analytics_router)
app.include_router(auth_router)
app.include_router(coverage_router)
app.include_router(workspace_router)
app.include_router(alerts_router)
app.include_router(security_router)
app.include_router(data_router)
app.include_router(live_router)
app.include_router(practice_router)
app.include_router(onchain_router)
app.include_router(proofs_router)
app.include_router(wallet_router)


@app.middleware("http")
async def private_workspace_responses(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(
        (
            "/api/workspaces",
            "/api/auth/profile",
            "/api/alerts",
            "/api/auth/security",
            "/api/practice",
            "/api/proofs",
            "/api/wallet",
        )
    ):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Vary"] = "Cookie, Origin"
    return response


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request, exc):
    if request.url.path.startswith("/api/auth/security"):
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Check the security fields. New passwords require "
                "8–128 nonblank characters; codes and passwords are "
                "never echoed."
            },
            headers={"Cache-Control": "private, no-store"},
        )
    if request.url.path.startswith("/api/alerts"):
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Use up to 20 distinct alert rules with valid "
                "pairs, metrics, positive thresholds up to 100 and "
                "ISO expiry dates."
            },
            headers={"Cache-Control": "private, no-store"},
        )
    if request.url.path.startswith("/api/auth/profile"):
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Only name may be edited: use 1–100 characters, "
                "without blank or control-character input."
            },
            headers={"Cache-Control": "private, no-store"},
        )
    if request.url.path.startswith("/api/workspaces"):
        # Never echo request inputs (including personal notes) in validation errors.
        return JSONResponse(
            status_code=422,
            content={
                "detail": (
                    "Invalid workspace. Check title (1–120), notes (up to 5000), "
                    "configuration version 1, ISO selections and compatible settings."
                )
            },
            headers={"Cache-Control": "private, no-store"},
        )
    if request.url.path.startswith("/api/auth/"):
        return JSONResponse(
            status_code=422,
            content={
                "detail": (
                    "Check your email, name and password "
                    "(8–128 characters for sign up)."
                )
            },
            headers={"Cache-Control": "no-store"},
        )
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(Exception)
async def unexpected_error(request, exc):
    # Fail visibly without leaking SQLite URLs, local paths or exception text.
    response = JSONResponse(
        status_code=500,
        content={
            "detail": (
                "Workspace service is unavailable. Retry when the backend is ready."
                if request.url.path.startswith("/api/workspaces")
                else "Account service is unavailable."
                if request.url.path.startswith("/api/auth/")
                else "Unable to read research data."
            )
        },
    )
    if request.url.path.startswith(
        (
            "/api/workspaces",
            "/api/auth/profile",
            "/api/alerts",
            "/api/auth/security",
            "/api/practice",
            "/api/proofs",
            "/api/wallet",
        )
    ):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Vary"] = "Cookie, Origin"
    # ServerErrorMiddleware sits outside CORSMiddleware. Preserve the same
    # allowlist here so browsers see HTTP 500 rather than a network/CORS failure.
    origin = request.headers.get("origin")
    if origin and origin in settings.cors_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    elif "*" in settings.cors_origins:
        response.headers["Access-Control-Allow-Origin"] = "*"
    return response
