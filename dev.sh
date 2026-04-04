#!/usr/bin/env bash
# dev.sh — Start backend + frontend dev server together
# Usage: ./dev.sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Detect virtual environment
PYTHON="python3"
if [ -f "$ROOT/.venv/bin/python" ]; then
    PYTHON="$ROOT/.venv/bin/python"
    echo "→ Using venv: $ROOT/.venv"
fi

# Kill child processes on exit
cleanup() {
    echo ""
    echo "→ Shutting down..."
    kill 0
}
trap cleanup EXIT

echo "→ Starting backend on http://127.0.0.1:8000"
cd "$ROOT"
$PYTHON -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

# Wait briefly for backend to be ready
sleep 2

echo "→ Starting frontend dev server on http://localhost:5173"
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://127.0.0.1:8000"
echo "  Frontend: http://localhost:5173  (proxies /api to backend)"
echo ""
echo "  Press Ctrl+C to stop both."
echo ""

wait
