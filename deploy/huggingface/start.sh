#!/usr/bin/env bash
# Boots the whole demo inside one container: Postgres and Redis on loopback, migrations, then
# supervisord for the API (port 7860), the AI service, the worker and the demo viewer account.
# Storage is the container's own disk, so every restart starts from a freshly seeded demo.
set -euo pipefail

DATA_DIR="${DATA_DIR:-$HOME/data}"
PGDATA="$DATA_DIR/pg"
mkdir -p "$DATA_DIR/media" "$DATA_DIR/redis" "$DATA_DIR/models"

rand() { python -c "import secrets; print(secrets.token_urlsafe($1))"; }

# Secrets can be set as Space secrets; otherwise they are generated per boot, which is safe here
# because the database is recreated on every boot too.
export ENVIRONMENT=production DEBUG=false
export SECRET_KEY="${SECRET_KEY:-$(rand 48)}"
export INTERNAL_SERVICE_API_KEY="${INTERNAL_SERVICE_API_KEY:-$(rand 32)}"
export CAMERA_CREDENTIAL_ENCRYPTION_KEY="${CAMERA_CREDENTIAL_ENCRYPTION_KEY:-$(python -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')}"

export FIRST_ADMIN_EMAIL="${ADMIN_EMAIL:-admin@ccd-demo.com}"
export FIRST_ADMIN_NAME="${ADMIN_NAME:-Platform Administrator}"
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  ADMIN_PASSWORD="$(rand 12)"
  echo "ADMIN_PASSWORD is not set; admin password for this boot: $ADMIN_PASSWORD"
fi
export FIRST_ADMIN_PASSWORD="$ADMIN_PASSWORD"
export DEMO_EMAIL="${DEMO_EMAIL:-recruiter@ccd-demo.com}"
export DEMO_PASSWORD="${DEMO_PASSWORD:-ViewOnly-2026}"

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
FRONTEND_URL="${FRONTEND_URL%/}"
export CORS_ORIGINS="[\"$FRONTEND_URL\", \"http://localhost:3000\"]"
export PUBLIC_DASHBOARD_URL="$FRONTEND_URL"

export DATABASE_URL="postgresql+asyncpg://ccd@127.0.0.1:5432/ccd"
export REDIS_URL="redis://127.0.0.1:6379/0"
export BACKEND_URL="http://127.0.0.1:7860"
export STORAGE_DIR="$DATA_DIR/media" MEDIA_DIR="$DATA_DIR/media"
export SEED_DEMO_DATA=true SEED_DEMO_HISTORY=true
export DEVICE=cpu YOLO_MODEL=/srv/models/yolo11n.pt MODEL_CACHE_DIR="$DATA_DIR/models"
export NOTIFICATION_EMAIL_PROVIDER=console NOTIFICATION_SMS_PROVIDER=console \
       NOTIFICATION_WHATSAPP_PROVIDER=console NOTIFICATION_PUSH_PROVIDER=console \
       NOTIFICATION_ANNOUNCEMENT_PROVIDER=console

# Trust auth is safe: Postgres listens on loopback only and the container exposes just 7860.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" -U ccd --auth=trust >/dev/null
fi
pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -k /tmp" -l "$DATA_DIR/postgres.log" -w start
createdb -h 127.0.0.1 -U ccd ccd 2>/dev/null || true

redis-server --bind 127.0.0.1 --port 6379 --dir "$DATA_DIR/redis" --save "" --appendonly no --daemonize yes
until redis-cli ping >/dev/null 2>&1; do sleep 0.2; done

(cd /srv/apps/backend && /opt/venv-backend/bin/alembic upgrade head)

exec supervisord -c /srv/deploy/huggingface/supervisord.conf
