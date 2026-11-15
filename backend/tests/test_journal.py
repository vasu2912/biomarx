import datetime as dt
import json
import os

import numpy as np
import pytest

from biomarx.core.analysis import exposures as ex
from biomarx.core.analysis.sleep import Nights
from biomarx.core.journal import MAX_CUSTOM, Journal, JournalError, custom_key
from biomarx.core.services.journal import JournalService
from biomarx.impl.journal import FileJournalStore

D = 1440
TODAY = dt.date(2026, 6, 1)
ORIGIN = dt.date(2026, 3, 2)


def nights(days: list[int], onset: int = 23 * 60, length: int = 480) -> Nights:
    night = np.array(days)
    i0 = night * D + onset
    return Nights(night, i0, i0 + length, {})


def service(tmp_path) -> JournalService:
    return JournalService(FileJournalStore(tmp_path / "journal.json"))


# ---------------------------------------------------------------- store


def test_store_round_trips_days_and_own_tags(tmp_path):
    js = service(tmp_path)
    tag = js.add_tag("  Late   screen ")
    js.set_day(dt.date(2026, 3, 3), frozenset({"alcohol", tag.key}), True, TODAY)
    js.set_day(dt.date(2026, 3, 2), frozenset(), True, TODAY)
    again = FileJournalStore(tmp_path / "journal.json").load()
    assert again == js.get()
    assert again.custom[0].label == "Late screen" and again.custom[0].key == custom_key("late screen")
    assert again.days == ((dt.date(2026, 3, 2), ()), (dt.date(2026, 3, 3), tuple(sorted(("alcohol", tag.key)))))


def test_unreadable_or_missing_file_is_an_empty_journal(tmp_path):
    store = FileJournalStore(tmp_path / "journal.json")
    assert store.load() == Journal()
    (tmp_path / "journal.json").write_text("{not json")
    assert store.load() == Journal()
    (tmp_path / "journal.json").write_text(json.dumps({"days": {"2026-13-40": []}}))
    assert store.load() == Journal()


def test_unknown_tags_in_the_file_are_dropped_but_the_day_stays_reviewed(tmp_path):
    (tmp_path / "journal.json").write_text(json.dumps({"days": {"2026-03-02": ["alcohol", "c-00000000"]}}))
    assert FileJournalStore(tmp_path / "journal.json").load().day(dt.date(2026, 3, 2)) == ("alcohol",)


def test_a_crash_before_the_rename_keeps_the_previous_journal(tmp_path, monkeypatch):
    js = service(tmp_path)
    js.set_day(dt.date(2026, 3, 2), frozenset({"sauna"}), True, TODAY)

    def crash(*_):
        raise OSError("power cut")

    monkeypatch.setattr(os, "replace", crash)
    with pytest.raises(OSError):
        js.set_day(dt.date(2026, 3, 2), frozenset({"cold"}), True, TODAY)
    monkeypatch.undo()
    assert js.get().day(dt.date(2026, 3, 2)) == ("sauna",)  # the half-written temp file is never read
    js.set_day(dt.date(2026, 3, 2), frozenset({"cold"}), True, TODAY)  # and the next write replaces it
    assert js.get().day(dt.date(2026, 3, 2)) == ("cold",) and not (tmp_path / "journal.json.tmp").exists()


# ---------------------------------------------------------------- validation


def test_days_are_validated(tmp_path):
    js = service(tmp_path)
    for d in (dt.date(1899, 12, 31), TODAY + dt.timedelta(days=1)):
        with pytest.raises(JournalError, match="between 1900-01-01 and today"):
            js.set_day(d, frozenset(), True, TODAY)
    with pytest.raises(JournalError, match="Unknown tag: wine"):
        js.set_day(TODAY, frozenset({"wine"}), True, TODAY)
    with pytest.raises(JournalError, match="reviewed day"):
        js.set_day(TODAY, frozenset({"alcohol"}), False, TODAY)
    js.set_day(TODAY, frozenset({"alcohol"}), True, TODAY)
    js.set_day(TODAY, frozenset(), False, TODAY)
    assert js.get().day(TODAY) is None


def test_own_tags_are_validated_and_adding_one_twice_converges(tmp_path):
    js = service(tmp_path)
    for bad in ("", "   ", "x" * 25):
        with pytest.raises(JournalError, match="1 to 24 characters"):
            js.add_tag(bad)
    with pytest.raises(JournalError, match="already a tag"):
        js.add_tag("alcohol")
    first = js.add_tag("Nap")
    assert js.add_tag("nap ") == first and len(js.get().custom) == 1
    for i in range(MAX_CUSTOM - 1):
        js.add_tag(f"tag {i}")
    with pytest.raises(JournalError, match="up to 20"):
        js.add_tag("one more")
    js.set_day(TODAY, frozenset({first.key, "sauna"}), True, TODAY)
    js.remove_tag(first.key)
    js.remove_tag(first.key)
    assert js.get().day(TODAY) == ("sauna",) and len(js.get().custom) == MAX_CUSTOM - 1
    with pytest.raises(JournalError, match="Built-in"):
        js.remove_tag("sauna")


# ---------------------------------------------------------------- exposures


def test_tag_groups_leave_out_unreviewed_days():
    n = nights([0, 1, 2, 3])
    j = Journal(((ORIGIN, ("alcohol",)), (ORIGIN + dt.timedelta(days=1), ()), (ORIGIN + dt.timedelta(days=3), ("sauna",))))
    got = ex.tag_groups(n, j, ORIGIN, "alcohol")
    assert got[0] == 1 and got[1] == 0 and np.isnan(got[2]) and got[3] == 0


def test_a_tag_needs_five_nights_on_each_side():
    j = Journal(tuple((ORIGIN + dt.timedelta(days=i), ("alcohol",) if i < 5 else ()) for i in range(9)))
    with pytest.raises(ex.Unavailable, match="5 nights follow a day tagged “Alcohol” and 4 a reviewed day without it"):
        ex.need_both(ex.tag_groups(nights(list(range(9))), j, ORIGIN, "alcohol"), "a day tagged “Alcohol”", "a reviewed day without it")
    codes = ex.tag_groups(nights(list(range(10))), Journal(j.days + ((ORIGIN + dt.timedelta(days=9), ()),)), ORIGIN, "alcohol")
    assert ex.need_both(codes, "", "").tolist() == [1] * 5 + [0] * 5


def test_drinks_count_before_onset_and_absence_counts_only_on_vouched_days():
    n = nights([1, 2, 3, 4, 5])
    drinks = (
        np.array([1 * D + 20 * 60, 2 * D + 19 * 60, 4 * D + 23 * 60 + 30, 5 * D + 12 * 60]),
        np.array([2.0, 0.0, 1.0, 1.0]),
    )
    ok = np.array([False, True, False, True, False])
    got = ex.drink_groups(n, drinks, ok)
    # night 1: 2 drinks at 20:00. night 2: a zero log and vouched. night 3: nothing logged, not vouched.
    # night 4: a drink after onset, so its timing against sleep is unclear. night 5: a drink at noon.
    assert got[0] == 1 and got[1] == 0 and np.isnan(got[2]) and np.isnan(got[3]) and got[4] == 1


def test_vouching_takes_any_food_log_or_a_review_without_the_tag():
    n = nights([1, 2, 3, 4])
    tags = [None, ("sauna",), ("alcohol",), None]
    got = ex.vouched(n, np.array([4 * D + 9 * 60]), tags, "alcohol")
    assert got.tolist() == [False, True, False, True]


def test_caffeine_within_eight_hours_of_onset():
    n = nights([1, 2, 3, 4])  # onset 23:00
    caf = (np.array([1 * D + 15 * 60, 2 * D + 14 * 60 + 59, 2 * D + 8 * 60, 4 * D + 23 * 60 + 10]), np.array([80.0, 95, 60, 40]))
    got = ex.caffeine_groups(n, caf, np.array([False, False, True, True]))
    # night 1: 15:00, exactly 8 h before. night 2: last at 14:59, 8 h 1 min before. night 3: none, vouched. night 4: during the night.
    assert got[0] == 1 and got[1] == 0 and got[2] == 0 and np.isnan(got[3])


def test_custom_tags_join_the_catalogue_between_the_journal_and_the_logs():
    j, tag = Journal().with_custom("Nap")
    keys = list(ex.catalogue(j))
    assert keys[:3] == ["workout_timing", "hard_workout_timing", "morning_daylight"]
    assert keys.index(f"tag:{tag.key}") == keys.index("tag:stress") + 1 and keys[-2:] == ["alcohol_logged", "caffeine_logged"]
