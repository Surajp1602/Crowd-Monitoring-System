# Single-container demo for a free Hugging Face Docker Space: Postgres, Redis, the backend API,
# the AI service (simulated cameras, CPU) and the notification worker, with the API on port 7860.
# The dashboard is hosted separately (Vercel) and calls this container's URL.
#
# The Space repo holds only this file and README.md; the code is cloned from GitHub at build time.
# Local test with the working tree instead of GitHub (from the repo root):
#   docker build -f deploy/huggingface/Dockerfile --build-context source=<clean copy of the repo> -t ccd-hf .

ARG REPO_OWNER=Surajp1602
ARG REPO_NAME=Crowd-Monitoring-System
ARG REF=main

FROM alpine/git:2.45.2 AS clone
ARG REPO_OWNER
ARG REPO_NAME
ARG REF
# Changes whenever the branch moves, so a rebuild never reuses a stale clone from the layer cache.
ADD https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${REF} /tmp/head.json
RUN git clone --depth 1 --branch "${REF}" "https://github.com/${REPO_OWNER}/${REPO_NAME}.git" /src

FROM scratch AS source
COPY --from=clone /src/ /

# Pinned to bookworm: its Postgres is 15 (the PATH below) and its package names match the apt list.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
        postgresql postgresql-contrib redis-server \
        build-essential libpq-dev libpq5 \
        libglib2.0-0 libgl1 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install supervisor==4.2.5

WORKDIR /srv
COPY --from=source /packages/common /srv/packages/common
COPY --from=source /apps/backend/requirements.txt /srv/apps/backend/
COPY --from=source /apps/worker/requirements.txt /srv/apps/worker/
COPY --from=source /apps/ai-service/requirements.txt /srv/apps/ai-service/

# One virtualenv per service, exactly as their own images install them.
RUN cd /srv/apps/backend && python -m venv /opt/venv-backend \
    && /opt/venv-backend/bin/pip install -r requirements.txt
RUN cd /srv/apps/worker && python -m venv /opt/venv-worker \
    && /opt/venv-worker/bin/pip install -r requirements.txt
# CPU-only torch first, so ultralytics doesn't pull the multi-gigabyte CUDA build.
RUN cd /srv/apps/ai-service && python -m venv /opt/venv-ai \
    && /opt/venv-ai/bin/pip install torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/venv-ai/bin/pip install -r requirements.txt

ENV YOLO_CONFIG_DIR=/tmp/ultralytics
RUN mkdir -p /srv/models && cd /srv/models \
    && /opt/venv-ai/bin/python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"

COPY --from=source /apps/backend /srv/apps/backend
COPY --from=source /apps/worker /srv/apps/worker
COPY --from=source /apps/ai-service /srv/apps/ai-service
COPY --from=source /deploy/huggingface /srv/deploy/huggingface
RUN sed -i 's/\r$//' /srv/deploy/huggingface/start.sh /srv/deploy/huggingface/supervisord.conf \
    && chmod +x /srv/deploy/huggingface/start.sh

# Hugging Face runs the container as uid 1000; everything it writes lives under its home.
RUN useradd --create-home --uid 1000 user && chown -R user /srv/models
USER user
ENV HOME=/home/user \
    PATH=/usr/lib/postgresql/15/bin:$PATH

EXPOSE 7860
CMD ["/srv/deploy/huggingface/start.sh"]
