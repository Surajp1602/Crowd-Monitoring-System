# API

Base URL: `https://<APP_HOST>` behind the edge, `http://localhost:8000` in development. The OpenAPI
schema is always at `/api/openapi.json`. Swagger UI (`/api/docs`) and ReDoc (`/api/redoc`) are served
outside production.

## Authentication

```bash
# operator sign-in: an access token (30 min) and a refresh token (14 days)
curl -s -X POST $API/api/v1/auth/login -H 'Content-Type: application/json'   -d '{"email":"admin@ccd-platform.com","password":"..."}'

# read-only guest session, no account
curl -s -X POST $API/api/v1/auth/guest

# then
curl -s $API/api/v1/alerts -H "Authorization: Bearer $ACCESS"
```

- `POST /api/v1/auth/refresh` with `{"refresh_token": ...}` returns a new access token.
  `POST /api/v1/auth/logout` revokes the refresh token.
- Sign-in is limited per client address and account (default 10 per 5 minutes) and per address (50).
  Over the limit returns `429` with `Retry-After`.
- Each endpoint requires a permission (`camera:view`, `alert:manage`, ...). The token carries the
  role's permissions, and `GET /api/v1/auth/me` returns them.
- Internal endpoints (alert and metric ingest, camera sync) require `X-Internal-Api-Key` and are
  called only by the ai-service and the worker.

## Conventions

- Lists are paginated with `page` and `page_size` and return `{"items": [...], "total": n, "page": p,
  "page_size": s}`.
- Timestamps are ISO 8601 in UTC. Floor coordinates are metres. Density is people/m².
- Errors are `{"detail": "..."}` with the usual status codes: 401 (no or bad token), 403 (missing
  permission), 404, 409 (conflict), 422 (validation), 429 (throttled).
- Snapshot and clip URLs in alert responses are signed and expire. Fetch them as returned.

## WebSocket: `/ws/live`

```text
client -> {"action": "auth", "token": "<access token>"}           first message, within 10 s
server -> {"type": "ready", "data": {"role": "...", "is_guest": false}}
client -> {"action": "subscribe", "topics": ["cameras", "floor:<id>", "alerts"]}
server -> {"type": "subscribed", "data": {"accepted": [...], "rejected": {"topic": "reason"}}}
server -> {"type": "<kind>", "topic": "<topic>", "data": {...}}     live messages
client -> {"action": "auth", "token": "<refreshed token>"}        any time, extends the session
client -> {"action": "ping"}   server -> {"type": "pong"}
```

| Topic | Permission | Messages |
|---|---|---|
| `cameras` | `camera:view` | health and person counts for every camera |
| `camera:<id>` | `camera:view` | detections with boxes and the annotated preview frame, tracks |
| `floor:<id>` | `map:view` | heatmap grid with isolines, people on the floor |
| `alerts` | `alert:view` | `alert.created`, `alert.updated` |

A new subscriber gets the latest snapshot for the topic at once. When the token expires the server
sends `auth.expired` and closes with code 4401, and the client refreshes and reconnects.

## Endpoints

Generated from the application's routes (128 operations).

### alerts

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/alerts` | List Alerts |
| `GET` | `/api/v1/alerts/stats` | Alert Stats |
| `GET` | `/api/v1/alerts/{alert_id}` | Get Alert |
| `PATCH` | `/api/v1/alerts/{alert_id}/status` | Update Alert Status |
| `POST` | `/api/v1/alerts` | Internal: ai-service anomaly ingest |
| `POST` | `/api/v1/alerts/bulk-status` | Bulk Update Status |

### analytics

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/analytics/alerts-by-day` | Alerts By Day |
| `GET` | `/api/v1/analytics/metrics` | List Metrics |
| `GET` | `/api/v1/analytics/peak-hours` | Peak Hours |
| `GET` | `/api/v1/analytics/summary` | Dashboard Summary |
| `GET` | `/api/v1/analytics/timeseries` | Timeseries |
| `GET` | `/api/v1/analytics/timeseries.csv` | Timeseries Csv |
| `GET` | `/api/v1/analytics/zones` | Zone Comparison |
| `POST` | `/api/v1/analytics/metrics` | Internal: ai-service/worker metric ingest |

### auth

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/auth/me` | Read Me |
| `POST` | `/api/v1/auth/guest` | Guest Session |
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/logout` | Logout |
| `POST` | `/api/v1/auth/refresh` | Refresh |
| `POST` | `/api/v1/auth/register` | Register User |

### buildings

| Method | Path | Summary |
|---|---|---|
| `DELETE` | `/api/v1/buildings/{building_id}` | Delete Building |
| `GET` | `/api/v1/buildings` | List Buildings |
| `GET` | `/api/v1/buildings/{building_id}` | Get Building |
| `PATCH` | `/api/v1/buildings/{building_id}` | Update Building |
| `POST` | `/api/v1/buildings` | Create Building |

### cameras

| Method | Path | Summary |
|---|---|---|
| `DELETE` | `/api/v1/cameras/{camera_id}` | Delete Camera |
| `GET` | `/api/v1/cameras` | List Cameras |
| `GET` | `/api/v1/cameras/{camera_id}` | Get Camera |
| `PATCH` | `/api/v1/cameras/{camera_id}` | Update Camera |
| `POST` | `/api/v1/cameras` | Create Camera |
| `POST` | `/api/v1/cameras/{camera_id}/health` | Internal: ai-service heartbeat for a camera's status/fps/latency |

### events

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/events` | List Events |

### floors

| Method | Path | Summary |
|---|---|---|
| `DELETE` | `/api/v1/floors/{floor_id}` | Delete Floor |
| `GET` | `/api/v1/floors` | List Floors |
| `GET` | `/api/v1/floors/{floor_id}` | Get Floor |
| `PATCH` | `/api/v1/floors/{floor_id}` | Update Floor |
| `POST` | `/api/v1/floors` | Create Floor |

### health

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness |
| `GET` | `/api/v1/health/ready` | Readiness |

### live

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/live/cameras` | Live Camera Status |
| `GET` | `/api/v1/live/floors/{floor_id}/heatmap` | Latest Heatmap |

### media

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/media/{path}` | Signed media download (alert snapshots, clips) |

### misc

| Method | Path | Summary |
|---|---|---|
| `GET` | `/health` | Root Health |

### notifications

| Method | Path | Summary |
|---|---|---|
| `DELETE` | `/api/v1/notifications/subscriptions/{subscription_id}` | Delete Subscription |
| `GET` | `/api/v1/notifications/history` | List Notification History |
| `GET` | `/api/v1/notifications/providers` | Provider Status |
| `GET` | `/api/v1/notifications/subscriptions` | List Subscriptions |
| `POST` | `/api/v1/notifications/subscriptions` | Create Subscription |
| `POST` | `/api/v1/notifications/subscriptions/unsubscribe` | Unsubscribe |
| `POST` | `/api/v1/notifications/test` | Send Test |

### settings

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/settings` | List Settings |
| `GET` | `/api/v1/settings/{key}` | Get Setting |
| `PUT` | `/api/v1/settings/{key}` | Update Setting |

### system

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/system/health` | System Health |

### users

| Method | Path | Summary |
|---|---|---|
| `DELETE` | `/api/v1/users/{user_id}` | Delete User |
| `GET` | `/api/v1/users` | List Users |
| `GET` | `/api/v1/users/roles` | List Roles |
| `GET` | `/api/v1/users/{user_id}` | Get User |
| `PATCH` | `/api/v1/users/{user_id}` | Update User |

### zones

| Method | Path | Summary |
|---|---|---|
| `DELETE` | `/api/v1/zones/{zone_id}` | Delete Zone |
| `GET` | `/api/v1/zones` | List Zones |
| `GET` | `/api/v1/zones/{zone_id}` | Get Zone |
| `PATCH` | `/api/v1/zones/{zone_id}` | Update Zone |
| `POST` | `/api/v1/zones` | Create Zone |

## Metrics

`GET /metrics` (Prometheus text) on the internal network only. The edge returns 404. Set
`METRICS_TOKEN` to require a bearer token as well. Series: `ccd_http_requests_total{method, route,
status}` and `ccd_http_request_duration_seconds{method, route}`, labelled by route template.
