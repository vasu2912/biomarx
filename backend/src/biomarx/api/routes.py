from __future__ import annotations

import datetime as dt
from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from biomarx.api import schemas as s
from biomarx.container import Container
from biomarx.core.metrics import DAILY_KEYS, METRICS
from biomarx.core.services.imports import CHUNK_SIZE, ImportConflict, ImportRejected
from biomarx.core.services.insights import InsightService, RasterName, Window

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

router = APIRouter(prefix="/api")


def container(request: Request) -> Container:
    return request.app.state.container


def insights(c: Annotated[Container, Depends(container)]) -> InsightService:
    return c.insights


def window(
    ins: Annotated[InsightService, Depends(insights)],
    start: Annotated[dt.date | None, Query(description="First day, inclusive")] = None,
    end: Annotated[dt.date | None, Query(description="Last day, exclusive")] = None,
) -> Window:
    if start and end and end <= start:
        raise HTTPException(422, "end must be after start.")
    if ins.dataset() is None:
        raise HTTPException(404, "No dataset imported yet.")
    return ins.window(start, end)


Ins = Annotated[InsightService, Depends(insights)]
Win = Annotated[Window, Depends(window)]


def _range(w: Window) -> s.RangeOut:
    return s.RangeOut(start=w.range.start, end=w.range.end)


IMPORT_ERRORS = {404: {"model": s.ErrorOut}, 409: {"model": s.ErrorOut}, 422: {"model": s.ErrorOut}}


def _import_error(e: Exception) -> HTTPException:
    if isinstance(e, KeyError):
        return HTTPException(404, "Unknown import.")
    return HTTPException(422 if isinstance(e, ImportRejected) else 409, str(e))


async def _chunk_body(request: Request) -> bytes:
    data = bytearray()
    async for part in request.stream():
        data += part
        if len(data) > CHUNK_SIZE:
            raise HTTPException(413, "Chunk is larger than the chunk size.")
    return bytes(data)


# ---------------------------------------------------------------- status and imports


@router.get("/status")
def status(c: Annotated[Container, Depends(container)]) -> s.StatusOut:
    ds = c.store.dataset()
    job = c.imports.jobs.active()
    return s.StatusOut(dataset=s.DatasetOut.of(ds) if ds else None, active_import=s.ImportJobOut.of(job) if job else None)


@router.get("/metrics")
def metrics() -> list[s.MetricOut]:
    return [s.MetricOut.of(m) for m in METRICS]


@router.post("/imports", status_code=201, responses={409: {"model": s.ErrorOut}, 422: {"model": s.ErrorOut}})
def create_import(body: s.CreateImportIn, c: Annotated[Container, Depends(container)]) -> s.CreateImportOut:
    try:
        job = c.imports.create(body.filename, body.size)
    except (ImportRejected, ImportConflict) as e:
        raise _import_error(e) from e
    return s.CreateImportOut(job=s.ImportJobOut.of(job), chunk_size=CHUNK_SIZE)


@router.put("/imports/{job_id}/chunks/{index}", responses={**IMPORT_ERRORS, 413: {"model": s.ErrorOut}})
async def put_chunk(job_id: str, index: int, request: Request, c: Annotated[Container, Depends(container)]) -> s.ImportJobOut:
    data = await _chunk_body(request)
    try:
        return s.ImportJobOut.of(c.imports.put_chunk(job_id, index, data))
    except (KeyError, ImportRejected, ImportConflict) as e:
        raise _import_error(e) from e


@router.post("/imports/{job_id}/commit", responses=IMPORT_ERRORS)
def commit_import(job_id: str, c: Annotated[Container, Depends(container)]) -> s.ImportJobOut:
    try:
        return s.ImportJobOut.of(c.imports.commit(job_id))
    except (KeyError, ImportConflict) as e:
        raise _import_error(e) from e


@router.get("/imports/{job_id}", responses={404: {"model": s.ErrorOut}})
def get_import(job_id: str, c: Annotated[Container, Depends(container)]) -> s.ImportJobOut:
    job = c.imports.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown import.")
    return s.ImportJobOut.of(job)


# ---------------------------------------------------------------- tables


@router.get("/summary")
def summary(ins: Ins, w: Win) -> s.SummaryOut:
    return s.SummaryOut(range=_range(w), values={k: s.num(v) for k, v in ins.summary(w).items()})


@router.get("/daily", responses={422: {"model": s.ErrorOut}})
def daily(ins: Ins, w: Win, metrics: Annotated[str | None, Query(description="Comma-separated metric keys")] = None) -> s.DailyOut:
    keys = tuple(k for k in metrics.split(",") if k) if metrics else None
    if unknown := sorted(set(keys or ()) - set(DAILY_KEYS)):
        raise HTTPException(422, f"Unknown metric: {', '.join(unknown)}.")
    cols = ins.daily(w, keys) if keys else ins.daily(w)
    return s.DailyOut(range=_range(w), days=ins.days(w), columns={k: s.vec(v) for k, v in cols.items()})


@router.get("/nights")
def nights(ins: Ins, w: Win) -> s.NightsOut:
    n = ins.nights(w)
    return s.NightsOut(range=_range(w), nights=[w.day(int(i)) for i in n.night], columns={k: s.vec(v) for k, v in n.cols.items()})


@router.get(
    "/rasters/{name}",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}, "description": "Row-major matrix; see X-Shape, X-Dtype, X-Start"}},
)
def raster(name: RasterName, ins: Ins, w: Win) -> Response:
    r = ins.raster(w, name)
    return Response(
        r.data,
        media_type="application/octet-stream",
        headers={
            "X-Shape": f"{r.rows},{r.cols}",
            "X-Dtype": r.dtype,
            "X-Start": r.start.isoformat(),
            "Cache-Control": "private, max-age=300",
        },
    )


# ---------------------------------------------------------------- analyses


@router.get("/analysis/architecture")
def architecture(ins: Ins, w: Win) -> s.ArchitectureOut:
    a = ins.architecture(w)
    return s.ArchitectureOut(
        range=_range(w),
        nights=a["nights"],
        minutes=a["minutes"],
        order=a["order"],
        probability={k: s.vec(v) for k, v in a["probability"].items()},
        transitions=s.mat(a["transitions"]),
        transition_counts=s.mat(a["transition_counts"], 0),
    )


@router.get("/analysis/chronotype")
def chronotype(ins: Ins, w: Win) -> s.ChronotypeOut:
    c = ins.chronotype(w)
    return s.ChronotypeOut(
        range=_range(w),
        histograms={k: [int(x) for x in v] for k, v in c["histograms"].items()},
        circular={k: s.CircularOut(hour=s.num(h), r=s.num(r)) for k, (h, r) in c["circular"].items()},
        weekday=[
            s.WeekdayOut(
                weekday=d,
                label=WEEKDAYS[d],
                free=d in (4, 5),
                values=s.vec(v, 3),
                median=s.num(np.median(v)) if len(v) else None,
            )
            for d, v in enumerate(c["weekday_mid"])
        ],
        msw=s.num(c["msw"]),
        msf=s.num(c["msf"]),
        msfsc=s.num(c["msfsc"]),
        social_jetlag_min=s.num(c["social_jetlag_min"]),
    )


@router.get("/analysis/periodogram")
def periodogram(ins: Ins, w: Win) -> s.PeriodogramOut:
    p = ins.periodogram(w)
    return s.PeriodogramOut(
        range=_range(w),
        periods=s.vec(p["periods"]),
        hr=s.vec(p["hr"], 6),
        steps=s.vec(p["steps"], 6),
        dominant_hr_period=s.num(p["dominant_hr_period"]),
    )


@router.get("/analysis/correlation")
def correlation(ins: Ins, w: Win) -> s.CorrelationOut:
    c = ins.correlation(w)
    return s.CorrelationOut(range=_range(w), metrics=c["metrics"], rho=s.mat(c["rho"], 3), q=s.mat(c["q"], 5), n=s.mat(c["n"], 0))


@router.get("/analysis/state")
def state(ins: Ins, w: Win) -> s.StateOut:
    st = ins.state(w)
    return s.StateOut(range=_range(w), days=ins.days(w), metrics=st["metrics"], z=s.mat(st["z"], 2))


@router.get("/analysis/hr-activity")
def hr_activity(ins: Ins, w: Win) -> s.HrActivityOut:
    h = ins.hr_activity(w)
    d, r = h["dose_response"], h["ridgeline"]
    return s.HrActivityOut(
        range=_range(w),
        dose_response=s.DoseResponseOut(
            x_edges=s.vec(d["x_edges"]),
            y_edges=s.vec(d["y_edges"]),
            counts=s.mat(d["counts"], 0),
            median_x=s.vec(d["median_x"]),
            median_hr=s.vec(d["median_hr"], 2),
            bins=d["bins"],
        ),
        ridgeline=s.RidgelineOut(
            hr=s.vec(r["hr"], 2),
            months=[
                s.RidgeMonthOut(
                    month=m["month"],
                    awake=None if m["awake"] is None else s.vec(m["awake"], 4),
                    asleep=None if m["asleep"] is None else s.vec(m["asleep"], 4),
                )
                for m in r["months"]
            ],
        ),
    )


# ---------------------------------------------------------------- ecg


def _ecg_summary(rec, a: dict) -> s.EcgSummaryOut:
    return s.EcgSummaryOut(
        id=rec.id,
        recorded_at=rec.recorded_at,
        classification=rec.classification,
        sample_rate=rec.sample_rate,
        device=rec.device,
        duration_s=round(rec.microvolts.size / rec.sample_rate, 2),
        mean_hr=s.num(a["mean_hr"], 1),
        rmssd=s.num(a["rmssd"], 1),
    )


@router.get("/ecg")
def ecg_list(ins: Ins) -> list[s.EcgSummaryOut]:
    out = []
    for rec in ins.store.ecg_recordings():
        _, a = ins.ecg(rec.id)  # type: ignore[misc]
        out.append(_ecg_summary(rec, a))
    return out


@router.get("/ecg/{ecg_id}", responses={404: {"model": s.ErrorOut}})
def ecg_detail(ecg_id: str, ins: Ins) -> s.EcgDetailOut:
    found = ins.ecg(ecg_id)
    if found is None:
        raise HTTPException(404, "Unknown recording.")
    rec, a = found
    return s.EcgDetailOut(
        summary=_ecg_summary(rec, a),
        trace=s.vec(a["trace"], 4),
        peaks=[int(p) for p in a["peaks"]],
        rri=s.vec(a["rri"], 1),
        sd1=s.num(a["sd1"], 1),
        sd2=s.num(a["sd2"], 1),
        beat_ms=s.vec(a["beat_ms"], 2),
        beat_median=s.vec(a["beat_median"], 4),
        beats=s.mat(a["beats"], 4),
    )
