from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    static_dir: Path
    host: str
    port: int

    @property
    def db_path(self) -> Path:
        return self.data_dir / "biomarx.duckdb"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            data_dir=Path(os.environ.get("BIOMARX_DATA_DIR", ROOT / "data")).resolve(),
            static_dir=Path(os.environ.get("BIOMARX_STATIC_DIR", ROOT / "frontend" / "dist")).resolve(),
            host=os.environ.get("BIOMARX_HOST", "127.0.0.1"),
            port=int(os.environ.get("BIOMARX_PORT", "4174")),
        )
