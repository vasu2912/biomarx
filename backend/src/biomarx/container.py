"""Composition root: the only place that knows which adapters implement which ports."""

from __future__ import annotations

from dataclasses import dataclass

from biomarx.config import Settings
from biomarx.core.ports import JobRunner
from biomarx.core.services.imports import ImportService
from biomarx.core.services.insights import InsightService
from biomarx.impl.apple_health import AppleHealthReader
from biomarx.impl.duckdb_store import DuckStore
from biomarx.impl.jobs import MemoryJobRegistry, ThreadJobRunner
from biomarx.impl.uploads import FileUploadStore


@dataclass
class Container:
    settings: Settings
    store: DuckStore
    imports: ImportService
    insights: InsightService
    runner: JobRunner


def build(settings: Settings, runner: JobRunner | None = None) -> Container:
    store = DuckStore(settings.db_path)
    uploads = FileUploadStore(settings.upload_dir)
    uploads.discard_all()
    runner = runner or ThreadJobRunner()
    imports = ImportService(store, AppleHealthReader(), uploads, MemoryJobRegistry(), runner)
    return Container(settings, store, imports, InsightService(store), runner)
