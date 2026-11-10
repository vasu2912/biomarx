from __future__ import annotations

import logging
import uuid
from pathlib import Path

from biomarx.core.domain import ImportJob, ImportState
from biomarx.core.ports import ExportFormatError, ExportReader, JobRegistry, JobRunner, Store, UploadStore
from biomarx.core.services.derivation import derive

log = logging.getLogger(__name__)

CHUNK_SIZE = 32 * 1024 * 1024
MAX_EXPORT_BYTES = 8 * 1024**3

PARSE_SHARE = 0.8


class ImportRejected(ValueError):
    """The request itself is invalid: wrong file, size or chunk index."""


class ImportConflict(Exception):
    """The request is valid but the import is not in a state that accepts it."""


class ImportService:
    def __init__(self, store: Store, reader: ExportReader, uploads: UploadStore, jobs: JobRegistry, runner: JobRunner):
        self.store, self.reader, self.uploads, self.jobs, self.runner = store, reader, uploads, jobs, runner

    def create(self, filename: str, size: int) -> ImportJob:
        if size <= 0:
            raise ImportRejected("This file is empty.")
        if size > MAX_EXPORT_BYTES:
            raise ImportRejected("Exports larger than 8 GB are not supported.")
        if not filename.lower().endswith((".zip", ".xml")):
            raise ImportRejected("Choose the export.zip from the Health app, or its export.xml.")
        if active := self.jobs.active():
            if active.state != ImportState.UPLOADING:
                raise ImportConflict("Another import is already being processed.")
            active.fail("Replaced by a newer upload.")
            self.uploads.discard(active.id)
        job = ImportJob(id=uuid.uuid4().hex, filename=filename, size=size, message="Uploading")
        self.uploads.create(job.id)
        self.jobs.add(job)
        return job

    def put_chunk(self, job_id: str, index: int, data: bytes) -> ImportJob:
        job = self._job(job_id, ImportState.UPLOADING)
        if index < 0 or index * CHUNK_SIZE >= job.size:
            raise ImportRejected("Chunk is out of range.")
        received = self.uploads.write_chunk(job_id, index, data)
        job.report(received / job.size, f"Uploaded {received / 1e6:.0f} of {job.size / 1e6:.0f} MB")
        return job

    def commit(self, job_id: str) -> ImportJob:
        job = self._job(job_id, ImportState.UPLOADING)
        try:
            path = self.uploads.assemble(job_id, job.filename)
        except OSError:
            log.exception("import %s could not be assembled", job.id)
            self.uploads.discard(job_id)
            job.fail("Could not assemble the upload. The server log has the details.")
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
        except ExportFormatError as e:
            job.fail(str(e))
        except Exception:  # the job is the error boundary for background work
            log.exception("import %s failed", job.id)
            job.fail("The export could not be read. The server log has the details.")
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
            raise ImportConflict(f"Import is {job.state}, expected {state}.")
        return job
