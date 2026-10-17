# Build stage: compilers and headers for the wheels that need them, kept out of the runtime image.
FROM python:3.11-slim AS build

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY packages/common /srv/packages/common
COPY apps/backend/requirements.txt apps/backend/requirements-dev.txt /srv/apps/backend/

WORKDIR /srv/apps/backend
ARG INSTALL_DEV=false
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && if [ "$INSTALL_DEV" = "true" ]; then /opt/venv/bin/pip install -r requirements-dev.txt; \
       else /opt/venv/bin/pip install -r requirements.txt; fi

# Runtime stage: the virtualenv, the code and an unprivileged user.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 ccd \
    && mkdir -p /data/media && chown ccd /data/media

COPY --from=build /opt/venv /opt/venv
COPY packages/common /srv/packages/common
COPY apps/backend /srv/apps/backend
WORKDIR /srv/apps/backend

USER ccd
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

# --proxy-headers with a trusted forwarder list lets uvicorn report the real scheme behind NGINX.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
