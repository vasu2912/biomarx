from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from biomarx.core.domain import ImportJob


class ThreadJobRunner:
    """One worker: imports run strictly one at a time."""

    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="import")

    def submit(self, fn: Callable[[], None]) -> None:
        self._pool.submit(fn)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


class InlineJobRunner:
    def submit(self, fn: Callable[[], None]) -> None:
        fn()


class MemoryJobRegistry:
    def __init__(self) -> None:
        self._jobs: dict[str, ImportJob] = {}
        self._lock = threading.Lock()

    def add(self, job: ImportJob) -> None:
        with self._lock:
            self._jobs[job.id] = job

    def get(self, job_id: str) -> ImportJob | None:
        return self._jobs.get(job_id)

    def active(self) -> ImportJob | None:
        with self._lock:
            live = [j for j in self._jobs.values() if j.active]
        return max(live, key=lambda j: j.created_at) if live else None
