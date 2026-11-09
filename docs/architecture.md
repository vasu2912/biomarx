# Biomarx architecture

Biomarx is a self-hosted chronobiology and physiology observatory for one person's wearable data. A user uploads an Apple Health `export.zip` once. The server ingests it into an embedded columnar database, derives every analysis table, and serves compact range queries to a React client that draws them.

## Done means

- `uv run biomarx ingest ~/Downloads/export.zip` finishes and leaves `data/biomarx.duckdb` with raw records, grids, nights and daily metrics.
- `backend/scripts/parity.py` reproduces the headline numbers from the reference analysis (`health_viz/viz.py`) on its 365-day window within stated tolerances.
- Uploading the zip through the UI runs the same pipeline with live progress, and every chapter renders from the API with real data.

## Monolith layout

```
backend/            Python 3.13, uv, FastAPI, DuckDB, NumPy, SciPy
  src/biomarx/
    core/           pure domain: types, metric registry, ports, analysis math, services
    impl/           adapters: Apple Health reader, DuckDB store, upload store, job runner
    api/            FastAPI app, routes, response schemas, static hosting
    cli.py          `biomarx ingest`, `biomarx serve`, `biomarx openapi`
  tests/
  scripts/parity.py
frontend/           React 19, Vite, TypeScript, Tailwind v4
  src/
    app/            providers, router, shell
    core/           domain types (generated from OpenAPI), pure stats and formatting
    infra/          API client, raster decoding, query hooks
    ui/             design system: tokens, primitives, chart kit
    features/       one folder per chapter (import, overview, sleep, rhythm, heart, patterns, mobility, ecg)
data/               runtime state (gitignored): biomarx.duckdb, uploads/
```

Dependency direction is `api -> core <- impl`. `core` imports nothing from `impl` or FastAPI. Services receive their ports in the constructor. `api/app.py` is the composition root.

## Storage

DuckDB, one file per profile. It is embedded (no server to run), columnar, and aggregates millions of rows in milliseconds, which suits a read-heavy visualization workload with a single writer. Multi-profile support later means one database file per profile, so tables carry no user column.

An Apple Health export is always a full snapshot of the history. An import therefore replaces the dataset atomically inside one transaction: the import is idempotent and a re-import of a newer export converges to the same state as a fresh one.

| Table | Grain | Purpose |
|---|---|---|
| `records` | one Apple Health `<Record>` | raw quantities and categories, local wall-clock times |
| `workouts` | one `<Workout>` | type, duration, source |
| `ecg` | one recording | metadata plus the raw microvolt samples |
| `grids` | one named matrix | minute-level arrays stored as blobs: `hr1` float32 [days,1440], `sleep` uint8 [days,1440], `worn` uint8 [days,1440], `steps10` float32 [days,144] |
| `nights` | one main sleep episode | onset, offset, stage minutes, nocturnal physiology |
| `daily` | one calendar day D | activity of D, sleep of night D, RHR of D+1, cosinor, NPCRA, SRI, gait |
| `dataset` | one row | span, counts, sources, import time, version |
| `imports` | one import job | state machine and progress |

Times are local wall-clock, as recorded by the device. That is the right clock for circadian analysis.

## Domain rules ported from the reference analysis

- Source de-duplication. Heart rate and resting HR keep, per calendar day, the source with the most samples. Steps take the max across sources per 10-minute bin. Sleep keeps, per night, the source with the most staged minutes.
- A night D is the sleep that starts after noon on D. Its main episode is the longest cluster of asleep segments joined across gaps of at most 60 minutes, and it counts only if total sleep time is at least 3 h.
- A day is valid when the watch was worn (HR sample within 15 minutes) for more than 60% of it.
- Cosinor uses a 3-day window of 5-minute HR with a 24 h period. Fits with R² < 0.15 are hidden from MESOR, amplitude and acrophase views.
- NPCRA (IS, IV, RA, M10, L5) uses a 14-day sliding window of hourly steps and hourly HR.
- SRI follows Phillips et al. 2017 on minute sleep/wake state of consecutive valid days.
- Correlations are Spearman with Benjamini-Hochberg FDR. Order comes from average-linkage clustering on 1 - |rho|.

## API contract

All routes live under `/api`. Ranges use `start` and `end` as ISO dates, `end` exclusive. When omitted they default to the last 365 days of the dataset. Every JSON payload is columnar where it holds series: one array of days plus one array per metric, with `null` for missing values.

| Method and path | Returns |
|---|---|
| `GET /status` | `{ dataset: Dataset or null, activeImport: ImportJob or null }` |
| `GET /metrics` | the metric registry: key, label, unit, group, decimals, direction, description |
| `POST /imports` `{filename, size}` | `ImportJob` in state `uploading`, plus `chunkSize` |
| `PUT /imports/{id}/chunks/{index}` | raw bytes of one chunk; returns `{received}` |
| `POST /imports/{id}/commit` | starts the pipeline; returns `ImportJob` |
| `GET /imports/{id}` | `ImportJob` with `state`, `phase`, `progress` 0..1, `message`, `error` |
| `GET /summary` | headline numbers for the range |
| `GET /daily` | `{ days: string[], columns: Record<metric, (number or null)[]> }` |
| `GET /nights` | columnar nights: `night`, onset/offset hours, stage minutes, physiology |
| `GET /rasters/{name}` | binary row-major matrix for `sleep`, `hr5`, `steps10` with headers `X-Shape: rows,cols`, `X-Dtype`, `X-Start` |
| `GET /analysis/architecture` | stage probability by minute since onset, Markov transition matrix |
| `GET /analysis/chronotype` | 96-bin clock histograms, circular means, mid-sleep by weekday, MSW, MSF, MSFsc, social jet lag |
| `GET /analysis/periodogram` | Lomb-Scargle power for HR and steps over log-spaced periods, dominant period |
| `GET /analysis/correlation` | ordered metrics, rho matrix, FDR q matrix, pair counts |
| `GET /analysis/state` | robust z-score matrix, metrics in correlation order, days |
| `GET /analysis/hr-activity` | 2D histogram of steps vs HR per 10-minute bin, median curve, monthly KDE ridgelines split by sleep state |
| `GET /ecg` | list of recordings with summary stats |
| `GET /ecg/{id}` | filtered trace, R-peaks, RR intervals, Poincare SD1/SD2, ensemble beat |

The `sleep` raster codes are `0` not worn, `1` awake and worn, `2` awake in bed, `3` core, `4` REM, `5` deep.

The OpenAPI schema is the type source of truth. `pnpm gen:api` in `frontend/` regenerates `src/core/api.gen.ts` from `uv run biomarx openapi`.
