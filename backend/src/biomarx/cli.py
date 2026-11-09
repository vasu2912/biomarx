from __future__ import annotations

import json
import time
from pathlib import Path

import typer

from biomarx.config import Settings

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.command()
def ingest(path: Path) -> None:
    """Import an Apple Health export.zip or export.xml from disk."""
    from biomarx.container import build
    from biomarx.impl.jobs import InlineJobRunner

    c = build(Settings.from_env(), InlineJobRunner())
    t0 = time.perf_counter()
    job = c.imports.ingest_path(path.expanduser())
    if job.error:
        typer.echo(f"failed: {job.error}", err=True)
        raise typer.Exit(1)
    typer.echo(f"{job.message} in {time.perf_counter() - t0:.0f}s -> {c.settings.db_path}")


@app.command()
def serve(reload: bool = False) -> None:
    """Run the API and the built frontend."""
    import uvicorn

    s = Settings.from_env()
    uvicorn.run("biomarx.api.app:create_app", factory=True, host=s.host, port=s.port, reload=reload)


@app.command()
def openapi() -> None:
    """Print the OpenAPI schema (used to generate frontend types)."""
    from biomarx.api.app import create_app

    typer.echo(json.dumps(create_app(lazy=True).openapi(), indent=1))


def main() -> None:
    app()
