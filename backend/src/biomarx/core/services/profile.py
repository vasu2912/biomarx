"""The effective profile: what the user entered wins over what the export says."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Literal

from biomarx.core.domain import Sex
from biomarx.core.ports import ProfileOverrides, Store

Source = Literal["export", "user"] | None


@dataclass(frozen=True)
class Profile:
    birth_date: dt.date | None
    sex: Sex | None
    age: int | None
    birth_date_source: Source
    sex_source: Source


class ProfileService:
    def __init__(self, store: Store, overrides: ProfileOverrides) -> None:
        self.store, self.overrides = store, overrides

    def get(self) -> Profile:
        ds = self.store.dataset()
        user_birth, user_sex = self.overrides.load()
        export_birth = ds.birth_date if ds else None
        export_sex = ds.sex if ds and ds.sex != "unknown" else None
        birth, birth_src = _pick(user_birth, export_birth)
        sex, sex_src = _pick(user_sex, export_sex)
        on = ds.timeline.end - dt.timedelta(days=1) if ds else dt.date.today()
        return Profile(birth, sex, age_on(birth, on) if birth else None, birth_src, sex_src)

    def set(self, birth_date: dt.date | None, sex: Sex | None) -> Profile:
        self.overrides.save(birth_date, sex)
        return self.get()


def age_on(birth: dt.date, day: dt.date) -> int:
    """Whole years completed on `day`."""
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


def _pick(user, export) -> tuple:
    if user is not None:
        return user, "user"
    if export is not None:
        return export, "export"
    return None, None
