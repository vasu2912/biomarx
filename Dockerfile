FROM node:24-slim AS web
RUN corepack enable
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv \
    BIOMARX_HOST=0.0.0.0 BIOMARX_PORT=4174 BIOMARX_DATA_DIR=/data BIOMARX_STATIC_DIR=/app/frontend/dist
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN useradd --system --uid 10001 biomarx && mkdir -p /data && chown biomarx /data
USER biomarx
VOLUME ["/data"]
EXPOSE 4174
CMD ["/opt/venv/bin/biomarx", "serve"]
