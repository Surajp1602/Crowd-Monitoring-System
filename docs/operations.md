# Operations

How to run CCD in production, keep it healthy and recover it. For local development see the
[README](../README.md).

## Choose a deployment

| | Docker Compose (`docker-compose.prod.yml`) | Kubernetes (`deploy/k8s`) |
|---|---|---|
| Fits | One site, one GPU server | Several sites, or when you already run a cluster |
| Postgres, Redis | Containers on the same host | Managed services (RDS / Cloud SQL / Azure Database, ElastiCache / Memorystore / Azure Cache) |
| TLS | Your certificate files in `infra/nginx/certs` | cert-manager `Certificate` into the `ccd-tls` secret |
| Scaling | Fixed | HPA on backend, frontend and worker. The ai-service is one GPU pod. |

Both run the same images and the same NGINX edge, so behaviour (rate limits, headers, routing) is
identical.

### Hardware

The detector defaults to `yolo11n` (the smallest YOLO11 model) at 640 px input and uses CUDA when it
finds a GPU, falling back to CPU. Throughput depends on the GPU, resolution and crowd size, so measure
it on your hardware before sizing. The System health page shows each camera's fps and latency, and
`frame_skip` and `input_size` on AI settings trade accuracy for throughput. As a reference point, the
development machine (GTX 1650) runs the eight simulated demo cameras at about 8 fps each. Simulated
feeds skip the model, so they measure the rest of the pipeline only.

## Docker Compose

```bash
cp .env.production.example .env.production       # fill in every value; see "Secrets"
# certificates: real ones as infra/nginx/certs/fullchain.pem and privkey.pem,
# or for a trial run:
sh infra/scripts/dev-certs.sh
make prod-config                                  # stops with the name of any missing value
make prod-up                                      # builds and starts behind the edge on 80/443
make prod-monitoring                              # optional: Prometheus and Grafana
```

Point DNS for `APP_HOST` (the control center) and `SITE_HOST` (the product site) at the server. Only
ports 80 and 443 are published. Grafana listens on `127.0.0.1:3001`: reach it over an SSH tunnel.

With GPU inference, add the GPU overlay as well:
`docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.prod.yml ...`.

**Upgrading.** `git pull`, then `make prod-up`. The `migrate` service runs `alembic upgrade head`
before the backend starts.

## Kubernetes

```bash
# 1. secrets (never commit the filled-in file)
cp deploy/k8s/overlays/production/secrets.example.env secrets.prod.env   # fill in
kubectl create namespace ccd
kubectl -n ccd create secret generic ccd-secrets --from-env-file=secrets.prod.env

# 2. hosts and image tags: edit deploy/k8s/overlays/production/kustomization.yaml and certificate.yaml

# 3. migrate, then roll out
kubectl -n ccd delete job ccd-migrate --ignore-not-found
kubectl apply -k deploy/k8s/overlays/production
kubectl -n ccd wait --for=condition=complete job/ccd-migrate --timeout=5m
kubectl -n ccd rollout status deploy/backend
```

Requirements: a ReadWriteMany storage class for `ccd-media`, the NVIDIA device plugin on a GPU node
pool, cert-manager with a `letsencrypt-prod` ClusterIssuer, and a LoadBalancer for the `edge` service.
The `edge` service uses `externalTrafficPolicy: Local` so the rate limits see real client addresses.

To try it on a laptop cluster, `deploy/k8s/overlays/dev` adds Postgres, Redis, the demo station and
local image names (the comments at the top of that file have the commands).

## Secrets

| Name | What | Rotate |
|---|---|---|
| `SECRET_KEY` | Signs JWTs and media URLs. 48+ random characters. | Rotating signs everyone out and invalidates outstanding media links. Do it in a quiet hour. |
| `INTERNAL_SERVICE_API_KEY` | ai-service and worker calls to internal endpoints | Set the same new value on backend, ai-service and worker, then restart all three. |
| `CAMERA_CREDENTIAL_ENCRYPTION_KEY` | Fernet key for stored camera passwords | Changing it makes stored camera passwords unreadable. Re-enter them after rotating. |
| `FIRST_ADMIN_PASSWORD` | Seeds the first admin on an empty database only | Change the password in the app after first sign-in. |
| `POSTGRES_PASSWORD`, `DATABASE_URL`, `REDIS_URL` | Data stores | Through your database provider, then update the secret and restart. |
| Provider credentials | SMTP, Twilio, FCM, webhooks | Through the provider, then restart the worker. |

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The backend refuses to start with `ENVIRONMENT=production` while any of these still has its
development default, or while `DEBUG` is on.

## Backups and restore

Postgres holds everything that matters. Redis holds only live state and can be lost.

```bash
# nightly logical backup (Compose)
docker compose exec -T postgres pg_dump -U ccd -Fc ccd > ccd-$(date +%F).dump
# restore into an empty database
docker compose exec -T postgres pg_restore -U ccd -d ccd --clean --if-exists < ccd-2026-10-17.dump
```

On managed Postgres, turn on point-in-time recovery and keep 14+ days. Back up the media volume
(alert evidence) with your volume snapshots. Treat it as evidence: keep it as long as your incident
policy requires.

Retention is automatic: track points 7 days, frames 14 days, minute metrics 400 days
(`RETENTION_DAYS_*` on the worker). Alerts and notification history are kept until you delete them.

## Monitoring

- **Health.** `/health` on every service (backend 8000, ai-service 8080, worker 8090), `/healthz` on
  the edge. The dashboard's System health page shows the API, database, Redis, detection pipeline
  (per-camera fps and latency, GPU temperature) and the dispatcher (stream lag, pending, failed).
- **Metrics.** Prometheus scrapes the backend `/metrics`. The provisioned Grafana dashboard "CCD API"
  shows request rate by status, p50/p95 latency, the slowest routes and sign-in outcomes.
- **Alert rules** (`infra/monitoring/alerts.yml`): API down for 2 minutes, more than 5% of requests
  failing for 10 minutes, p95 latency above 1 s for 10 minutes, and sustained sign-in throttling
  (possible password guessing). Route them to your Alertmanager.

## Runbooks

**A camera shows offline.** System health lists cameras that are not delivering frames, with the last
error. Check the stream from the AI host (`ffprobe rtsp://...`). Credentials and URLs are edited on
the Cameras page; saving restarts that camera's worker. A `camera_offline` alert is raised on a
stream error and resolved automatically on recovery.

**Live views freeze, but the API works.** Redis or the WebSocket bridge. Check the Redis row on System
health. Dashboards reconnect by themselves after a Redis restart.

**Alerts appear on the dashboard, but nobody is notified.** Check the dispatcher row on the
Notifications page. Pending messages above zero and growing means the worker is down or a provider is
failing. Delivery history shows each attempt with the provider's response. Messages are retried 3
times, and pending entries from a dead worker are reclaimed after 60 s.

**Too many alerts.** Tune per-detector thresholds and cooldowns on AI settings. Repeats are grouped
into one alert for ten minutes. Use "Mark false positive" so the noise is visible in analytics.

**Sign-ins return 429.** Ten attempts per 5 minutes per address and account. Wait for `Retry-After`.
If the Grafana panel shows sustained throttling from many addresses, that is an attack, not a user.

**Restore after data loss.** Stop the stack, restore the latest Postgres dump, start `migrate`, then
the rest. The ai-service reconciles cameras from the database on start.
