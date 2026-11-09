# Biomarx

Biomarx turns an Apple Health export into a personal chronobiology and physiology observatory: minute-level sleep actograms, circadian rhythm fits, nocturnal cardiorespiratory trends, cross-metric correlations, gait, and single-lead ECG analysis.

You upload `export.zip` once. The server streams it into a local DuckDB file, derives every analysis, and serves the browser compact range queries. The upload is deleted after import, and nothing leaves the machine.

Lab-report (PDF) import from the earlier prototype is deferred. See `docs/architecture.md` for the design and API contract.

## Requirements

- Python 3.13 via [uv](https://docs.astral.sh/uv/)
- Node.js 22+ with pnpm

## Run in development

```bash
make install
make dev            # API on 127.0.0.1:4174, UI on 127.0.0.1:5173
```

Open the UI and drop in `export.zip` (Health app, profile picture, Export All Health Data). Or import from disk:

```bash
make ingest FILE=~/Downloads/export.zip
```

## Verify

```bash
make test           # backend unit + end-to-end tests, frontend lint and build
make parity VIZ=~/Downloads/health_viz/viz.py   # reproduce the reference analysis numbers
```

## Build and run

```bash
make build
cd backend && uv run biomarx serve     # serves the built UI and API on :4174
```

Or with Docker:

```bash
docker build -t biomarx .
docker run -p 127.0.0.1:4174:4174 -v biomarx-data:/data biomarx
```

Biomarx has no accounts. Keep it on a trusted machine, or put it behind an authenticating proxy such as Cloudflare Access before exposing it. Uploads go in 32 MiB chunks, which stays under Cloudflare's 100 MB request limit.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BIOMARX_DATA_DIR` | `./data` | DuckDB file and temporary uploads |
| `BIOMARX_STATIC_DIR` | `./frontend/dist` | built UI |
| `BIOMARX_HOST` | `127.0.0.1` | bind address |
| `BIOMARX_PORT` | `4174` | port |
