from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from biomarx.api.routes import router
from biomarx.config import Settings


def create_app(settings: Settings | None = None, lazy: bool = False) -> FastAPI:
    """App factory. `lazy` skips opening the database, for schema export."""
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if not lazy:
            from biomarx.container import build

            app.state.container = build(settings)
        yield
        runner = getattr(getattr(app.state, "container", None), "runner", None)
        if hasattr(runner, "shutdown"):
            runner.shutdown()

    app = FastAPI(title="Biomarx", version="0.2.0", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    # A page on another domain can re-point its DNS at 127.0.0.1; only loopback names reach the data.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", settings.host])
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.include_router(router)
    _mount_frontend(app, settings)
    return app


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Every error body is `{detail: str}`, the shape the UI renders."""
    e = exc.errors()[0]
    field = ".".join(str(p) for p in e["loc"][1:])
    return JSONResponse({"detail": f"{field}: {e['msg']}" if field else e["msg"]}, status_code=422)


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    dist = settings.static_dir
    index = dist / "index.html"
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(404, "Frontend not built. Run `pnpm build` in frontend/.")
