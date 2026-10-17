"""Security headers and Prometheus metrics for every HTTP response.

Metrics are labelled by route template (`/api/v1/alerts/{alert_id}`), never the raw path, so
cardinality stays bounded. `/metrics` is meant for the internal network: NGINX refuses it from
outside, and when METRICS_TOKEN is set a scraper must also send it as a bearer token.
"""

import secrets
import time

from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings

REQUESTS = Counter("ccd_http_requests_total", "HTTP requests", ["method", "route", "status"])
LATENCY = Histogram(
    "ccd_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
# The API serves JSON and signed images only, so it can forbid everything else outright. The
# interactive docs need their CDN assets, so they get the browser default.
API_CSP = "default-src 'none'; img-src 'self'; frame-ancestors 'none'"


def _route(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", None) or "unmatched"


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        route = _route(request)
        if route != "/metrics":
            LATENCY.labels(request.method, route).observe(time.perf_counter() - start)
            REQUESTS.labels(request.method, route, str(response.status_code)).inc()
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if not request.url.path.startswith(("/api/docs", "/api/redoc")):
            response.headers.setdefault("Content-Security-Policy", API_CSP)
        return response


def install(app: FastAPI) -> None:
    app.add_middleware(ObservabilityMiddleware)

    @app.get("/metrics", include_in_schema=False)
    async def metrics(request: Request) -> Response:
        token = get_settings().METRICS_TOKEN
        if token:
            sent = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
            if not secrets.compare_digest(sent, token):
                return Response(status_code=401)
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
