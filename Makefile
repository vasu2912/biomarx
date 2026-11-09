.PHONY: install dev api web ingest test parity lint build types

install:
	cd backend && uv sync
	cd frontend && pnpm install

api:
	cd backend && uv run biomarx serve --reload

web:
	cd frontend && pnpm dev

dev:
	$(MAKE) -j2 api web

ingest:
	cd backend && uv run biomarx ingest $(FILE)

test:
	cd backend && uv run pytest -q
	cd frontend && pnpm lint && pnpm build

parity:
	cd backend && uv run --with pandas --with matplotlib python scripts/parity.py $(VIZ)

lint:
	cd backend && uv run ruff check src tests scripts && uv run ruff format --check src tests scripts
	cd frontend && pnpm lint

types:
	cd frontend && pnpm gen:api

build:
	cd frontend && pnpm build
