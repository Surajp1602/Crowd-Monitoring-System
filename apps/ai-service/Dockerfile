# Default base ships CUDA-matched torch preinstalled, so ultralytics' torch
# requirement is already satisfied and nothing GPU-related is rebuilt here.
# CPU-only hosts: --build-arg BASE_IMAGE=python:3.11-slim (pip then installs torch).
ARG BASE_IMAGE=pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime
FROM ${BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY packages/common /srv/packages/common
COPY apps/ai-service/requirements.txt /srv/apps/ai-service/
WORKDIR /srv/apps/ai-service
RUN pip install --upgrade pip && pip install -r requirements.txt

# Bake the default weights into the image so first start needs no internet access.
RUN mkdir -p /srv/models \
    && cd /srv/models \
    && python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"

COPY apps/ai-service /srv/apps/ai-service

RUN useradd --create-home --uid 10001 ccd \
    && mkdir -p /data/media \
    && chown -R ccd /srv/apps/ai-service /srv/models /data/media
USER ccd

ENV YOLO_MODEL=/srv/models/yolo11n.pt
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["python", "-m", "app.main"]
