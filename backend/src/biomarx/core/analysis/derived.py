from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from biomarx.core.analysis.grids import Grids
from biomarx.core.analysis.sleep import Nights


@dataclass(frozen=True)
class Derived:
    """Everything computed once per import. `daily` columns are indexed by timeline day."""

    grids: Grids
    nights: Nights
    daily: dict[str, np.ndarray]
