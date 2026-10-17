# Crowd Density Mapping & Anomaly Detection Platform

An enterprise crowd-monitoring platform: multi-camera ingestion, YOLO/DeepSORT
person detection and tracking, live density heatmaps, a 3D facility map,
crowd anomaly detection (panic, stampede, violence, loitering, intrusion...),
real-time alerting, and historical analytics.

This repository is being built in phases (see [Roadmap](#roadmap)). Each phase
ships fully working code, not stubs — you can `docker compose up` after every
phase and exercise what's landed so far.

## Status

- [x] **Phase 0** — Monorepo scaffold, Docker Compose, shared DB schema package
- [x] **Phase 1** — Backend foundation: FastAPI, Postgres, JWT auth + RBAC, camera/map/alert/analytics CRUD
- [x] **Phase 2** — Next.js dashboard shell: auth (guest/authority), camera management, alerts, live summary
- [x] **Phase 3** — AI pipeline: YOLO + DeepSORT, floor projection, kinematics, crowd simulator for hardware-free demos
- [ ] Phase 4 — Real-time WebSocket layer + heatmap engine
- [ ] Phase 5 — 3D facility map (Three.js / React Three Fiber)
- [ ] Phase 6 — Anomaly detection + alert generation
- [ ] Phase 7 — Notifications (push/SMS/WhatsApp/email, pluggable)
- [ ] Phase 8 — Analytics dashboards + system health
- [ ] Phase 9 — Production hardening (NGINX, HTTPS, CI/CD, monitoring)
- [ ] Phase 10 — Cloud deploy configs + full documentation

## Architecture

```
crowd-density/
├── apps/
│   ├── backend/        FastAPI REST + WebSocket API, Alembic migrations, RBAC
│   ├── frontend/        Next.js dashboard — auth, camera mgmt, alerts, live summary
│   ├── ai-service/      YOLO + DeepSORT detection/tracking pipeline (Phase 3)
│   └── worker/          Celery workers for async/scheduled jobs (Phase 3+)
├── packages/
│   └── common/          Shared SQLAlchemy models, enums, RBAC catalogue,
│                         Pydantic message schemas — single source of truth
│                         for the DB schema and cross-service contracts.
├── infra/               nginx, deploy scripts, IaC (later phases)
├── docs/                Architecture/ER diagrams, guides (Phase 10)
└── docker-compose.yml
```

**Why a shared `packages/common`?** Both the backend API and the AI service
read/write the same tables (cameras, tracks, alerts, ...). Defining the
SQLAlchemy models once and importing them from both services means the
schema can never drift between producer and consumer.

Model columns that need a Postgres-only type (`UUID`, `JSONB`) use portable
`GUID`/`PortableJSON` wrappers (`packages/common/common/models/types.py`) so
the exact same models run against Postgres in production/dev and SQLite in
the fast unit-test suite.

## Quickstart (Docker Compose)

```bash
cp .env.example .env
docker compose build backend migrate frontend
docker compose up -d postgres redis
docker compose run --rm migrate alembic upgrade head
docker compose up -d backend frontend
```

- Dashboard: http://localhost:3000
- API: http://localhost:8000
- Swagger UI: http://localhost:8000/api/docs
- Health: http://localhost:8000/health

For frontend development with hot reload instead of the production container:

```bash
cd apps/frontend
npm install
npm run dev
```

`apps/frontend/.env.local` already points it at `http://localhost:8000`.

A first admin user is seeded automatically on startup from
`FIRST_ADMIN_EMAIL` / `FIRST_ADMIN_PASSWORD` in `.env` (defaults:
`admin@ccd-platform.com` / `ChangeMe123!`). **Change the password after first
login in any non-local environment.**

Try it:

```bash
# Guest session (read-only, no login required)
curl -s -X POST http://localhost:8000/api/v1/auth/guest

# Authority login
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ccd-platform.com","password":"ChangeMe123!"}'
```

### Adding a new database migration

Models live in `packages/common/common/models/`. After changing them:

```bash
docker compose build backend migrate
docker compose run --rm migrate alembic revision --autogenerate -m "describe the change"
```

The generated file lands inside the throwaway container, so `docker compose
run` (without `--rm`) + `docker cp` is needed to retrieve it if you don't
have a bind mount configured — or add a bind mount for faster local
iteration. Review the generated migration before applying it; autogenerate
is a starting point, not a guarantee.

## Running the backend test suite locally (fast, no Docker)

```bash
cd apps/backend
python -m venv .venv && . .venv/Scripts/activate  # or source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
```

Tests run against an in-memory SQLite database via the portable column types
described above — no Postgres/Docker required for the unit test suite.

### Frontend dependency pins (read before bumping)

`apps/frontend/package.json` intentionally pins `typescript` to `5.9.3` and
`eslint` to `9.39.5` rather than tracking `latest`. At time of writing,
TypeScript 7's native rewrite breaks Next.js's internal tsconfig parsing
(`next build` silently fails to resolve `@/*` path aliases with a "Module
not found" error — `tsc` itself works fine, since Next doesn't shell out to
it), and ESLint 10 crashes `eslint-config-next`'s config loader. Re-test both
`npm run build` and `npm run lint` before upgrading either.

## Roadmap

See the phase list above. Each phase is tracked as its own unit of work with
its own tests and a working `docker compose` stack at the end of it.

## License

Proprietary — internal enterprise platform (adjust as needed for your org).
