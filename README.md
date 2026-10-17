# CCD: Crowd Density Mapping and Anomaly Detection

CCD turns CCTV into a live density map of a venue and a stream of evidence-backed alerts. It ingests
many cameras, detects and tracks people (YOLO and DeepSORT), projects them onto the floor plan,
builds density heatmaps with isolines, and runs twelve crowd anomaly detectors: panic, running,
stampede risk, fighting, rapid density rise, congestion, counter-flow, abnormal stopping, suspicious
gathering, restricted-area intrusion, loitering and abandoned objects. Alerts reach staff by role and
the public by distance, by email, SMS, WhatsApp, push and public address. No face recognition.

- **Control center** (`apps/frontend`): overview, camera wall, 3D and plan facility map with a live
  density field, alert triage with snapshots, analytics, notifications, system health, AI settings,
  users and a read-only guest view.
- **Product site** (`apps/landing`): the public site, built with the Juried studio.

A simulated camera type renders a moving crowd through a two-floor demo station, so the whole
platform runs, alerts and all, with no cameras and no GPU.

## Quickstart

```bash
cp .env.example .env
docker compose up -d --build
```

| | |
|---|---|
| Control center | http://localhost:3000 (sign in as `admin@ccd-platform.com` / `ChangeMe123!`, or continue as guest) |
| API docs | http://localhost:8000/api/docs |
| Health | http://localhost:8000/health |

The first boot seeds roles, the first admin, the demo station with eight simulated cameras, a demo
team and 14 days of occupancy history. Set `SEED_DEMO_DATA=false` and `SEED_DEMO_HISTORY=false`
before the first boot for an empty system. With an NVIDIA GPU and the container toolkit, add
`-f docker-compose.gpu.yml`.

## Repository

```
apps/
  backend/      FastAPI REST and WebSocket API, auth and RBAC, alert ingest and grouping, Alembic
  ai-service/   capture, YOLO + DeepSORT, floor projection, heatmaps, anomaly detectors, simulator
  worker/       notification dispatch (Redis Streams), minute rollups, retention, demo history
  frontend/     Next.js 16 operator dashboard (React 19, Tailwind 4, react-three-fiber)
  landing/      product site (React + Vite + three.js), with its Juried brief and jury log
packages/
  common/       shared SQLAlchemy models, enums, permissions, message schemas
infra/
  nginx/        edge image: TLS, product site, proxy, rate limits, security headers
  monitoring/   Prometheus scrape config and alert rules, Grafana provisioning and dashboard
  scripts/      dev certificate generator
deploy/k8s/     Kustomize base plus dev and production overlays
docs/           architecture, database, API, operations, design direction
```

## Documentation

- [Architecture](docs/architecture.md): services, the frame-to-alert pipeline, Redis contracts,
  security model and design decisions
- [Database](docs/database.md): ER diagram generated from the models, tables, migrations
- [API](docs/api.md): authentication, conventions, the WebSocket protocol and every endpoint
- [Operations](docs/operations.md): production with Compose or Kubernetes, secrets, backups,
  monitoring and runbooks
- [Art direction](docs/design/art-direction.md): the shared visual language of the dashboard and site

## Development

Run the data stores in Docker and the services natively for hot reload:

```bash
docker compose up -d postgres redis
cd apps/backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # bin/ on Linux and macOS
.venv/Scripts/python -m uvicorn app.main:app --reload
cd apps/frontend && npm install && npm run dev
```

The ai-service and worker follow the same pattern (`python -m app.main`). `.claude/launch.json`
holds the full set of local commands and environment, ports 8000, 8080, 8090, 3000 and 5173.

### Tests

```bash
cd apps/backend    && pytest -q   # 57 tests, in-memory SQLite and a fake Redis
cd apps/worker     && pytest -q   # 18 tests
cd apps/ai-service && pip install -r requirements-test.txt && pytest -q   # 59 tests, no model stack
cd apps/frontend   && npm run lint && npm run typecheck && npm run build
```

The models use portable `GUID` and `PortableJSON` column types, so the same schema runs on Postgres
and on SQLite in the unit tests. CI (`.github/workflows/ci.yml`) also runs a migration round trip on
Postgres, builds every image, checks the NGINX config, renders the Kubernetes overlays and resolves
the production compose file.

### Migrations

Models live in `packages/common/common/models`. See [Database](docs/database.md#migrations) for
generating and reviewing a revision.

### Frontend dependency pins

`apps/frontend/package.json` pins `typescript` to `5.9.3` and `eslint` to `9.39.5`. TypeScript 7's
native rewrite breaks Next.js's tsconfig parsing (`next build` fails to resolve `@/*` aliases), and
ESLint 10 crashes `eslint-config-next`'s config loader. Re-test `npm run build` and `npm run lint`
before upgrading either.

## Production

```bash
cp .env.production.example .env.production   # fill in every secret
sh infra/scripts/dev-certs.sh                # or mount real certificates
make prod-up                                 # NGINX edge on 80/443, nothing else published
```

The backend refuses to start in production with any development secret. Kubernetes manifests, secret
rotation, backups, monitoring and runbooks are in [Operations](docs/operations.md).

## Build history

| Phase | Delivered |
|---|---|
| 0 | Monorepo, Docker Compose, shared schema package |
| 1 | FastAPI backend: Postgres, JWT auth and RBAC, camera, map, alert and analytics APIs |
| 2 | Next.js dashboard shell: guest and operator sign-in, camera management, alerts |
| 3 | AI pipeline: YOLO + DeepSORT, floor projection, kinematics, crowd simulator |
| 4 | WebSocket gateway, floor heatmaps with isolines, live dashboard, demo facility |
| 5 | 3D facility map and 2D layout editor |
| 6 | Twelve anomaly detectors with evidence snapshots and the alert lifecycle |
| 7 | Notification worker: staff and geofenced public routing, SMTP, Twilio, FCM and webhook providers |
| 8 | Analytics, system health, AI settings, user administration |
| Site | Product site built with Juried; calibrated jury 7.3 |
| Jury | Dashboard juried to 7.1 with accessibility gates clean; alert grouping |
| 9 | NGINX TLS edge, rate limiting, security headers, Prometheus and Grafana, CI, hardened images |
| 10 | Kubernetes deploy configs and the documentation set |

## License

Proprietary. Adjust for your organisation.
