from __future__ import annotations

import shutil
from pathlib import Path


class FileUploadStore:
    """Chunks land as numbered part files so a retried chunk simply overwrites itself."""

    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def _dir(self, job_id: str) -> Path:
        return self.root / job_id

    def create(self, job_id: str) -> None:
        self._dir(job_id).mkdir(parents=True, exist_ok=True)

    def write_chunk(self, job_id: str, index: int, data: bytes) -> int:
        part = self._dir(job_id) / f"{index:06d}.part"
        part.write_bytes(data)
        return sum(p.stat().st_size for p in self._dir(job_id).glob("*.part"))

    def assemble(self, job_id: str, filename: str) -> Path:
        d = self._dir(job_id)
        suffix = ".xml" if filename.lower().endswith(".xml") else ".zip"
        out = d / f"export{suffix}"
        with out.open("wb") as f:
            for part in sorted(d.glob("*.part")):
                with part.open("rb") as src:
                    shutil.copyfileobj(src, f, 1 << 20)
                part.unlink()
        return out

    def discard(self, job_id: str) -> None:
        shutil.rmtree(self._dir(job_id), ignore_errors=True)

    def discard_all(self) -> None:
        for d in self.root.iterdir():
            shutil.rmtree(d, ignore_errors=True)
