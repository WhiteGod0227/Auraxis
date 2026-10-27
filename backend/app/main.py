from fastapi import FastAPI
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.coverage import router as coverage_router
from app.api.foundation import router as foundation_router
from app.api.health import router as health_router
from app.api.workspaces import router as workspace_router
from app.core.config import get_settings
from app.core.logging import setup_logging

setup_logging()
settings = get_settings()

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(foundation_router)
app.include_router(analytics_router)
app.include_router(auth_router)
app.include_router(coverage_router)
app.include_router(workspace_router)


@app.middleware("http")
async def private_workspace_responses(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(("/api/workspaces", "/api/auth/profile")):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Vary"] = "Cookie, Origin"
    return response


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request, exc):
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
    if request.url.path.startswith(("/api/workspaces", "/api/auth/profile")):
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
