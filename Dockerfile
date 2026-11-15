# syntax=docker/dockerfile:1

FROM node:24-slim AS web
RUN corepack enable
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.13-slim AS api
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never
WORKDIR /src
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

# The runtime holds only the installed environment and the built UI: no uv, no source tree, no build caches.
FROM python:3.13-slim
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 \
    BIOMARX_HOST=0.0.0.0 BIOMARX_PORT=4174 BIOMARX_DATA_DIR=/data BIOMARX_STATIC_DIR=/app/web
RUN useradd --system --uid 10001 --no-create-home biomarx && mkdir /data && chown biomarx /data
COPY --from=api /opt/venv /opt/venv
COPY --from=web /app/frontend/dist /app/web
USER biomarx
VOLUME ["/data"]
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"BIOMARX_PORT\"]}/api/status', timeout=4)"]
ENTRYPOINT ["biomarx"]
CMD ["serve"]
