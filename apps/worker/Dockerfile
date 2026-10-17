FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY packages/common /srv/packages/common
COPY apps/worker/requirements.txt /srv/apps/worker/
WORKDIR /srv/apps/worker
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY apps/worker /srv/apps/worker
RUN useradd --create-home --uid 10001 ccd && chown -R ccd /srv/apps/worker
USER ccd

EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -f http://localhost:8090/health || exit 1

CMD ["python", "-m", "app.main"]
