import datetime as dt
import io
import zipfile

import numpy as np
import pytest
from fastapi.testclient import TestClient

from biomarx.api.app import create_app
from biomarx.config import Settings
from biomarx.container import build
from biomarx.core.services.imports import CHUNK_SIZE
from biomarx.impl.jobs import InlineJobRunner

DAYS = 21
START = dt.datetime(2026, 3, 2)
FMT = "%Y-%m-%d %H:%M:%S +0000"


def _rec(kind: str, typ: str, source: str, start: dt.datetime, end: dt.datetime, value, unit: str = "") -> str:
    return (
        f' <Record type="HK{kind}TypeIdentifier{typ}" sourceName="{source}" unit="{unit}" '
        f'startDate="{start.strftime(FMT)}" endDate="{end.strftime(FMT)}" value="{value}"/>\n'
    )


def synthetic_export() -> bytes:
    """Three weeks of minute HR, hourly steps and one staged night per day, 23:30 to 07:00."""
    lines = ['<?xml version="1.0"?>\n<HealthData>\n', f' <ExportDate value="{START.strftime(FMT)}"/>\n']
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
