import datetime as dt
import io
import zipfile

import numpy as np
import pytest
from fastapi.testclient import TestClient

from biomarx.api.app import create_app
from biomarx.config import Settings
from biomarx.container import build
from biomarx.core.services import derivation
from biomarx.core.services.derivation import rederive
from biomarx.core.services.imports import CHUNK_SIZE
from biomarx.core.services.profile import age_on
from biomarx.impl.apple_health import parse_me
from biomarx.impl.jobs import InlineJobRunner

DAYS = 21
START = dt.datetime(2026, 3, 2)
FMT = "%Y-%m-%d %H:%M:%S +0000"


def _rec(kind: str, typ: str, source: str, start: dt.datetime, end: dt.datetime, value, unit: str = "") -> str:
    return (
        f' <Record type="HK{kind}TypeIdentifier{typ}" sourceName="{source}" unit="{unit}" '
        f'startDate="{start.strftime(FMT)}" endDate="{end.strftime(FMT)}" value="{value}"/>\n'
    )


def synthetic_export(me: str = "") -> bytes:
    """Three weeks of minute HR, hourly steps and one staged night per day, 23:30 to 07:00."""
    lines = ['<?xml version="1.0"?>\n<HealthData>\n', f' <ExportDate value="{START.strftime(FMT)}"/>\n', me]
    for d in range(DAYS):
        day = START + dt.timedelta(days=d)
        for m in range(0, 1440, 2):
            t = day + dt.timedelta(minutes=m)
            hr = 62 + 18 * np.cos(2 * np.pi * (m / 60 - 16) / 24)
            lines.append(_rec("Quantity", "HeartRate", "Watch", t, t, round(hr), "count/min"))
        for h in range(8, 22):
            t = day + dt.timedelta(hours=h)
            lines.append(_rec("Quantity", "StepCount", "Watch", t, t + dt.timedelta(minutes=30), 400, "count"))
        onset = day + dt.timedelta(hours=23, minutes=30)
        stages = [("AsleepCore", 90), ("AsleepDeep", 60), ("AsleepREM", 45), ("Awake", 10), ("AsleepCore", 120), ("AsleepREM", 125)]
        t = onset
        for stage, mins in stages:
            e = t + dt.timedelta(minutes=mins)
            lines.append(_rec("Category", "SleepAnalysis", "Watch", t, e, f"HKCategoryValueSleepAnalysis{stage}"))
            t = e
    lines.append("</HealthData>\n")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("apple_health_export/export.xml", "".join(lines))
    return buf.getvalue()


@pytest.fixture
def client(tmp_path):
    settings = Settings(data_dir=tmp_path, static_dir=tmp_path / "dist", host="127.0.0.1", port=0)
    app = create_app(settings, lazy=True)
    app.state.container = build(settings, InlineJobRunner())
    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c


def upload(client: TestClient, payload: bytes, name: str = "export.zip") -> dict:
    r = client.post("/api/imports", json={"filename": name, "size": len(payload)})
    assert r.status_code == 201, r.text
    job, chunk = r.json()["job"], r.json()["chunk_size"]
    for i in range(0, len(payload), chunk):
        assert client.put(f"/api/imports/{job['id']}/chunks/{i // chunk}", content=payload[i : i + chunk]).status_code == 200
    client.post(f"/api/imports/{job['id']}/commit")
    return client.get(f"/api/imports/{job['id']}").json()


def test_empty_install_reports_no_dataset(client):
    assert client.get("/api/status").json() == {"dataset": None, "active_import": None}
    assert client.get("/api/summary").status_code == 404


def test_import_then_query(client):
    job = upload(client, synthetic_export())
    assert job["state"] == "ready", job
    ds = client.get("/api/status").json()["dataset"]
    assert ds["days"] == DAYS

    s = client.get("/api/summary").json()["values"]
    assert s["nights"] >= DAYS - 2
    assert s["tst"] == pytest.approx((450 - 10) / 60, abs=0.05)
    assert s["onset_h"] == pytest.approx(23.5, abs=0.02)
    assert s["hr_acro"] == pytest.approx(16, abs=0.2)

    r = client.get("/api/rasters/sleep")
    rows, cols = map(int, r.headers["x-shape"].split(","))
    assert (rows, cols) == (DAYS, 1440)
    img = np.frombuffer(r.content, dtype=np.uint8).reshape(rows, cols)
    assert (img[5, 0:160] >= 3).all(), "after-midnight minutes of a night are painted as sleep"
    assert (img[5, 166:174] == 2).all(), "the 02:45 awake bout shows as awake in bed"

    arch = client.get("/api/analysis/architecture").json()
    assert arch["probability"]["deep"][100] == pytest.approx(1)


def test_reimport_converges_to_the_same_dataset(client):
    payload = synthetic_export()
    upload(client, payload)
    first = client.get("/api/summary").json()["values"]
    upload(client, payload)
    assert client.get("/api/summary").json()["values"] == first


def test_bad_upload_fails_and_keeps_the_previous_dataset(client):
    upload(client, synthetic_export())
    version = client.get("/api/status").json()["dataset"]["version"]
    job = upload(client, b"not a zip at all")
    assert job["state"] == "failed" and job["error"]
    assert client.get("/api/status").json()["dataset"]["version"] == version


def test_unexpected_failure_hides_internals(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("export.xml", b"\xff\xfe not utf-8")
    job = upload(client, buf.getvalue())
    assert job["state"] == "failed"
    assert job["error"] == "The export could not be read. The server log has the details."


def test_foreign_host_is_refused(client):
    assert client.get("/api/status", headers={"host": "attacker.example"}).status_code == 400
    assert client.get("/api/status", headers={"host": "localhost:4174"}).status_code == 200


@pytest.mark.parametrize(
    ("path", "detail"),
    [
        ("/api/summary?start=2026-03-10&end=2026-03-01", "end must be after start."),
        ("/api/daily?metrics=tst,nope", "Unknown metric: nope."),
        ("/api/summary?start=soon", "start: Input should be a valid date or datetime, input is too short"),
    ],
)
def test_bad_queries_return_422_with_a_message(client, path, detail):
    upload(client, synthetic_export())
    r = client.get(path)
    assert (r.status_code, r.json()) == (422, {"detail": detail})


def test_start_past_the_data_clamps_instead_of_failing(client):
    upload(client, synthetic_export())
    r = client.get("/api/summary?start=2030-01-01")
    assert r.status_code == 200 and r.json()["range"]["end"] == "2026-03-23"


def test_import_requests_are_validated(client):
    post = lambda body: client.post("/api/imports", json=body)  # noqa: E731
    assert post({"filename": "export.zip", "size": 0}).json() == {"detail": "This file is empty."}
    assert post({"filename": "notes.txt", "size": 10}).status_code == 422
    assert post({"filename": "export.zip"}).json() == {"detail": "size: Field required"}

    job = post({"filename": "export.zip", "size": 10}).json()["job"]
    assert client.put(f"/api/imports/{job['id']}/chunks/5", content=b"x").status_code == 422
    assert client.put(f"/api/imports/{job['id']}/chunks/0", content=b"x" * (CHUNK_SIZE + 1)).status_code == 413
    assert client.put("/api/imports/nope/chunks/0", content=b"x").status_code == 404


def test_a_new_upload_replaces_an_abandoned_one(client, tmp_path):
    first = client.post("/api/imports", json={"filename": "export.zip", "size": 10}).json()["job"]
    client.put(f"/api/imports/{first['id']}/chunks/0", content=b"x")
    client.post("/api/imports", json={"filename": "export.zip", "size": 10})
    assert not (tmp_path / "uploads" / first["id"]).exists()
    assert client.get(f"/api/imports/{first['id']}").status_code == 404


ME = (
    ' <Me HKCharacteristicTypeIdentifierDateOfBirth="1980-06-15" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexFemale"'
    ' HKCharacteristicTypeIdentifierBloodType="HKBloodTypeNotSet"/>\n'
)


def _age_old_build(client) -> None:
    """Make the live database look like an older build wrote it: no derivation version, one daily key missing."""
    store = client.app.state.container.store
    store._con.execute("ALTER TABLE daily DROP COLUMN sri; DELETE FROM meta WHERE key = 'derivation_version'")
    store._cache = None


def test_fresh_import_needs_no_rederive(client):
    upload(client, synthetic_export())
    assert not client.app.state.container.store.needs_rederive()
    assert rederive(client.app.state.container.store) is False


def test_old_database_is_rederived_from_its_records_and_converges(client):
    upload(client, synthetic_export(ME))
    store = client.app.state.container.store
    before = client.get("/api/summary").json()["values"]
    version = client.get("/api/status").json()["dataset"]["version"]
    _age_old_build(client)

    assert store.needs_rederive()
    assert np.isnan(store.derived().daily["sri"]).all(), "old data keeps serving, the new key reads as missing"

    assert rederive(store) is True
    status = client.get("/api/status").json()["dataset"]
    assert status["version"] != version
    assert client.get("/api/summary").json()["values"] == before
    assert client.get("/api/profile").json()["source"] == {"birth_date": "export", "sex": "export"}
    assert rederive(store) is False


def test_crash_during_rederive_keeps_the_live_database(client, monkeypatch):
    upload(client, synthetic_export())
    store = client.app.state.container.store
    version = client.get("/api/status").json()["dataset"]["version"]
    _age_old_build(client)

    def crash(_):
        raise RuntimeError("power cut")

    monkeypatch.setattr(derivation, "derive", crash)
    with pytest.raises(RuntimeError):
        rederive(store)
    assert client.get("/api/status").json()["dataset"]["version"] == version
    assert not store.path.with_name(store.path.name + ".staging").exists()

    monkeypatch.undo()
    assert rederive(store) is True and rederive(store) is False


def test_me_line_gives_birth_date_and_sex():
    assert parse_me(ME) == (dt.date(1980, 6, 15), "female")
    assert parse_me(' <Me HKCharacteristicTypeIdentifierDateOfBirth="" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet"/>') == (
        None,
        "unknown",
    )


def test_age_counts_completed_years():
    assert age_on(dt.date(1980, 6, 15), dt.date(2026, 6, 14)) == 45
    assert age_on(dt.date(1980, 6, 15), dt.date(2026, 6, 15)) == 46


def test_profile_prefers_the_user_override_and_survives_reimport(client):
    assert client.get("/api/profile").json() == {
        "birth_date": None,
        "sex": None,
        "age": None,
        "source": {"birth_date": None, "sex": None},
    }
    upload(client, synthetic_export(ME))
    # The dataset's last day is 2026-03-22.
    assert client.get("/api/profile").json() == {
        "birth_date": "1980-06-15",
        "sex": "female",
        "age": 45,
        "source": {"birth_date": "export", "sex": "export"},
    }
    r = client.put("/api/profile", json={"birth_date": "1990-03-22", "sex": "male"})
    assert r.json() == {"birth_date": "1990-03-22", "sex": "male", "age": 36, "source": {"birth_date": "user", "sex": "user"}}

    upload(client, synthetic_export(ME))
    assert client.get("/api/profile").json()["source"] == {"birth_date": "user", "sex": "user"}

    r = client.put("/api/profile", json={"birth_date": None, "sex": "female"})
    assert r.json()["birth_date"] == "1980-06-15" and r.json()["source"] == {"birth_date": "export", "sex": "user"}


@pytest.mark.parametrize(
    ("body", "detail"),
    [
        ({"birth_date": "1899-12-31"}, "birth_date: Value error, must be between 1900-01-01 and today"),
        ({"birth_date": (dt.date.today() + dt.timedelta(days=1)).isoformat()}, "birth_date: Value error, must be between 1900-01-01 and today"),
        ({"sex": "other"}, "sex: Input should be 'male' or 'female'"),
    ],
)
def test_profile_input_is_validated(client, body, detail):
    r = client.put("/api/profile", json=body)
    assert (r.status_code, r.json()) == (422, {"detail": detail})


def test_fitness_waits_for_a_profile_then_counts_workouts(client):
    t0 = START + dt.timedelta(days=3, hours=18)
    workout = (
        ' <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="30" sourceName="Watch" '
        f'startDate="{t0.strftime(FMT)}" endDate="{(t0 + dt.timedelta(minutes=30)).strftime(FMT)}"/>\n'
    )
    rest = _rec("Quantity", "RestingHeartRate", "Watch", START, START, 55, "count/min")
    upload(client, synthetic_export(workout + rest))
    f = client.get("/api/analysis/fitness").json()
    assert f["weeks"][0] == START.date().isoformat()
    assert f["hrmax"] is None and all(v is None for v in f["trimp"])
    assert f["strength_days"][0] == 1 and len(f["steps_bands"]) == 2

    client.put("/api/profile", json={"birth_date": "1986-01-01", "sex": "female"})
    f = client.get("/api/analysis/fitness").json()
    assert f["age"] == 40 and f["hrmax"] == pytest.approx(180)
    assert f["workouts"][0][0]["activity"] == "TraditionalStrengthTraining"
    assert f["workouts"][0][0]["trimp"] is not None and f["trimp"][0] == f["workouts"][0][0]["trimp"]
    assert [b["label"] for b in f["steps_bands"]] == ["Under 60"]


def test_baseline_adds_wrist_temperature_only_when_recorded(client):
    upload(client, synthetic_export())
    b = client.get("/api/analysis/baseline").json()
    assert [x["key"] for x in b["signals"]] == ["rhr_next", "hrv", "resp", "night_hr", "spo2"]
    assert len(b["days"]) == len(b["concurrent"]) == DAYS

    on = lambda d: START + dt.timedelta(days=d, hours=23, minutes=30)  # noqa: E731
    temp = lambda d: 36.5 if d == DAYS - 1 else 34 + d % 3 * 0.1  # noqa: E731
    temps = "".join(_rec("Quantity", "AppleSleepingWristTemperature", "Watch", on(d), on(d) + dt.timedelta(hours=7), temp(d), "degC") for d in range(DAYS))
    upload(client, synthetic_export(temps))
    b = client.get("/api/analysis/baseline").json()
    t = next(x for x in b["signals"] if x["key"] == "wrist_temp")
    assert t["concern"] == "up" and t["value"][0] == pytest.approx(34)
    assert t["z"][13] is None and t["median"][-2] == pytest.approx(34.1)
    assert t["z"][-2] == pytest.approx(0) and t["z"][-1] > 2  # the 36.5 night stands out from its 34.0–34.2 baseline


def test_seven_hours_counts_nights_at_the_floor(client):
    upload(client, synthetic_export())
    f = client.get("/api/analysis/seven-hours").json()
    assert f["floor_h"] == 7 and f["shortfall_nights"] == 14
    assert f["share"] == 100 and f["week_share"][0] == 100 and f["week_nights"][0] >= 6
    assert f["shortfall_median"] == 0 and f["shortfall"][:13] == [None] * 13
