from __future__ import annotations

import logging
import uuid
from pathlib import Path

from biomarx.core.domain import ImportJob, ImportState
from biomarx.core.ports import ExportReader, JobRegistry, JobRunner, Store, UploadStore
from biomarx.core.services.derivation import derive

log = logging.getLogger(__name__)

CHUNK_SIZE = 32 * 1024 * 1024
MAX_EXPORT_BYTES = 8 * 1024**3

PARSE_SHARE = 0.8


class ImportError_(Exception):
    """A request the import state machine cannot accept."""


class ImportService:
    def __init__(self, store: Store, reader: ExportReader, uploads: UploadStore, jobs: JobRegistry, runner: JobRunner):
        self.store, self.reader, self.uploads, self.jobs, self.runner = store, reader, uploads, jobs, runner

    def create(self, filename: str, size: int) -> ImportJob:
        if size <= 0 or size > MAX_EXPORT_BYTES:
            raise ImportError_("Exports larger than 8 GB are not supported.")
        if not filename.lower().endswith((".zip", ".xml")):
            raise ImportError_("Choose the export.zip from the Health app, or its export.xml.")
        if (active := self.jobs.active()) and active.state != ImportState.UPLOADING:
            raise ImportError_("Another import is already being processed.")
        job = ImportJob(id=uuid.uuid4().hex, filename=filename, size=size, message="Uploading")
        self.uploads.create(job.id)
        self.jobs.add(job)
        return job

    def put_chunk(self, job_id: str, index: int, data: bytes) -> ImportJob:
        job = self._job(job_id, ImportState.UPLOADING)
        if len(data) > CHUNK_SIZE or index < 0 or index * CHUNK_SIZE >= job.size:
            raise ImportError_("Chunk is out of range.")
        received = self.uploads.write_chunk(job_id, index, data)
        job.report(received / job.size, f"Uploaded {received / 1e6:.0f} of {job.size / 1e6:.0f} MB")
        return job

    def commit(self, job_id: str) -> ImportJob:
        job = self._job(job_id, ImportState.UPLOADING)
        try:
            path = self.uploads.assemble(job_id, job.filename)
        except OSError as e:
            job.fail(f"Could not assemble the upload: {e}")
            return job
        if path.stat().st_size != job.size:
            self.uploads.discard(job_id)
            job.fail(f"Upload incomplete: received {path.stat().st_size:,} of {job.size:,} bytes.")
            return job
        job.advance(ImportState.QUEUED, "Waiting to start")
        self.runner.submit(lambda: self.run(job, path))
        return job

    def ingest_path(self, path: Path) -> ImportJob:
        """Import a file already on disk (CLI). Runs the same pipeline synchronously."""
        job = ImportJob(id=uuid.uuid4().hex, filename=path.name, size=path.stat().st_size)
        self.jobs.add(job)
        job.advance(ImportState.QUEUED)
        self.run(job, path, keep_source=True)
        return job

    def run(self, job: ImportJob, path: Path, keep_source: bool = False) -> None:
        try:
            job.advance(ImportState.PARSING, "Reading export")
            with self.store.staging() as stage:
                self.reader.read(path, stage.sink, lambda f, msg, n: job.report(f * PARSE_SHARE, msg, n))
                job.advance(ImportState.DERIVING, "Building minute grids and sleep episodes", PARSE_SHARE)
                stage.finish_records()
                job.report(0.85, "Computing circadian, sleep and cardiovascular metrics")
                derived = derive(stage.reader)
                job.report(0.95, "Saving")
                stage.write_derived(derived)
                stage.publish()
            job.advance(ImportState.READY, f"{job.records:,} records, {len(derived.nights):,} nights", 1.0)
        except Exception as e:  # the job is the error boundary for background work
            log.exception("import %s failed", job.id)
            job.fail(str(e) or e.__class__.__name__)
        finally:
            if not keep_source:
                self.uploads.discard(job.id)

    def get(self, job_id: str) -> ImportJob | None:
        return self.jobs.get(job_id)

    def _job(self, job_id: str, state: ImportState) -> ImportJob:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.state != state:
            raise ImportError_(f"Import is {job.state}, expected {state}.")
        return job
