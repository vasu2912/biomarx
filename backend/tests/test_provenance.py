import numpy as np

from biomarx.core.analysis.provenance import source_codes


def test_sources_are_ordered_by_days_supplied_and_coded_per_day():
    best = {
        "hr": (np.array([0, 1, 2, 3]), np.array(["Band", "Band", "Watch", "Watch"], dtype=object)),
        "steps": (np.array([0, 1, 2, 9]), np.array(["Phone", "Watch", "Watch", "Phone"], dtype=object)),
    }
    names, codes = source_codes(best, 4)
    # Watch supplies days 1–3, Band 0–1, Phone only day 0 inside the timeline (day 9 is outside it).
    assert names == ["Watch", "Band", "Phone"]
    assert codes["hr"].tolist() == [1, 1, 0, 0]
    assert codes["steps"].tolist() == [2, 0, 0, -1]
