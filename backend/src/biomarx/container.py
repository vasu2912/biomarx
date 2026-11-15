"""Composition root: the only place that knows which adapters implement which ports."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from biomarx.config import Settings
from biomarx.core.ports import JobRunner
from biomarx.core.services.derivation import rederive
from biomarx.core.services.imports import ImportService
from biomarx.core.services.insights import InsightService
from biomarx.core.services.journal import JournalService
from biomarx.core.services.profile import ProfileService
from biomarx.impl.apple_health import AppleHealthReader
from biomarx.impl.duckdb_store import DuckStore
from biomarx.impl.jobs import MemoryJobRegistry, ThreadJobRunner
from biomarx.impl.journal import FileJournalStore
from biomarx.impl.profile import FileProfileOverrides
from biomarx.impl.uploads import FileUploadStore

log = logging.getLogger(__name__)


@dataclass
class Container:
    settings: Settings
    store: DuckStore
    imports: ImportService
    insights: InsightService
    profile: ProfileService
    runner: JobRunner
    journal: JournalService


def build(settings: Settings, runner: JobRunner | None = None) -> Container:
    store = DuckStore(settings.db_path)
    uploads = FileUploadStore(settings.upload_dir)
    uploads.discard_all()
    runner = runner or ThreadJobRunner()
    imports = ImportService(store, AppleHealthReader(), uploads, MemoryJobRegistry(), runner)
    profile = ProfileService(store, FileProfileOverrides(settings.data_dir / "profile.json"))
    journal = JournalService(FileJournalStore(settings.data_dir / "journal.json"))
    return Container(settings, store, imports, InsightService(store), profile, runner, journal)


def start_rederive(c: Container) -> None:
    """Bring a database derived by an older build up to date. Runs on the import worker, so it queues behind
    any import; the old derived data keeps serving until the new one swaps in."""

    def run() -> None:
        try:
            rederive(c.store)
        except Exception:  # background work: a failed re-derive leaves the live database as it was
            log.exception("re-derive failed")

    c.runner.submit(run)
