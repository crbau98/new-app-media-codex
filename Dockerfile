# syntax=docker/dockerfile:1

# ── Frontend builder ───────────────────────────────────────────────────────────
FROM node:22-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps
COPY frontend ./
RUN npm run build

# ── Python builder ─────────────────────────────────────────────────────────────
FROM python:3.12-slim AS python-build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
# Install dependencies into an isolated virtualenv that the runtime stage can
# copy verbatim and hand to a non-root user.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app

# Runtime-only system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=python-build /opt/venv /opt/venv

# Create a non-root user and hand it ownership of the app, venv, and data dir.
# The app writes its SQLite DB and media under /app/data (a mounted disk on
# Render), so that directory must be writable by the runtime user.
RUN groupadd --system app \
    && useradd --system --gid app --home-dir /app app \
    && mkdir -p /app/data \
    && chown -R app:app /app /opt/venv

# Copy application code (owned by the non-root user)
COPY --chown=app:app app /app/app
COPY --from=frontend-build --chown=app:app /frontend/dist /app/app/static/dist

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8080') + '/healthz', timeout=5)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --loop uvloop"]
