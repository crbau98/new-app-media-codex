#!/usr/bin/env bash
# =============================================================================
# apply-fixes.sh — Performance patch for new-app-media-codex
# Run this from the ROOT of your repo:  bash apply-fixes.sh
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(pwd)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   new-app-media-codex  performance patch  v1.0       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Dockerfile ─────────────────────────────────────────────────────────────
echo "[1/5] Patching Dockerfile (add --loop uvloop to uvicorn CMD)..."
if grep -q "\-\-loop uvloop" "$REPO_ROOT/Dockerfile"; then
  echo "      already patched — skipping"
else
  cp "$REPO_ROOT/Dockerfile" "$REPO_ROOT/Dockerfile.bak"
  sed -i 's|uvicorn app.main:app --host 0.0.0.0 --port \${PORT}"|uvicorn app.main:app --host 0.0.0.0 --port \${PORT} --loop uvloop"|' "$REPO_ROOT/Dockerfile"
  echo "      done  (backup saved as Dockerfile.bak)"
fi

# ── 2. requirements.txt ───────────────────────────────────────────────────────
echo "[2/5] Patching requirements.txt (add uvloop)..."
if grep -q "uvloop" "$REPO_ROOT/requirements.txt"; then
  echo "      already patched — skipping"
else
  cp "$REPO_ROOT/requirements.txt" "$REPO_ROOT/requirements.txt.bak"
  echo "uvloop>=0.21.0" >> "$REPO_ROOT/requirements.txt"
  echo "      done  (backup saved as requirements.txt.bak)"
fi

# ── 3. app/db.py — missing indexes ────────────────────────────────────────────
echo "[3/5] Patching app/db.py (add missing partial indexes)..."
DB_FILE="$REPO_ROOT/app/db.py"

if grep -q "idx_items_ai_summary" "$DB_FILE"; then
  echo "      already patched — skipping"
else
  cp "$DB_FILE" "${DB_FILE}.bak"
  # Insert two new CREATE INDEX lines immediately after the last existing index
  # in init(). We anchor on the idx_tags_name_lower line which is the last one.
  python3 - <<'PYEOF'
import re, sys

path = "app/db.py"
with open(path, "r") as f:
    content = f.read()

OLD = '''        conn.execute("CREATE INDEX IF NOT EXISTS idx_tags_name_lower ON tags(LOWER(name))")
        conn.commit()'''

NEW = '''        conn.execute("CREATE INDEX IF NOT EXISTS idx_tags_name_lower ON tags(LOWER(name))")
        # PERF FIX: partial indexes for frequent filter predicates
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_items_ai_summary "
            "ON items(id) WHERE ai_summary IS NOT NULL"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_items_theme "
            "ON items(theme) WHERE theme IS NOT NULL"
        )
        conn.commit()'''

if OLD in content:
    content = content.replace(OLD, NEW, 1)
    with open(path, "w") as f:
        f.write(content)
    print("      done  (backup saved as app/db.py.bak)")
else:
    print("      WARNING: anchor text not found — skipping db.py patch.")
    print("      Manually add these two lines in db.init() before conn.commit():")
    print('        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_ai_summary ON items(id) WHERE ai_summary IS NOT NULL")')
    print('        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_theme ON items(theme) WHERE theme IS NOT NULL")')
PYEOF
fi

# ── 4. app/api/items.py — queue endpoint pagination ───────────────────────────
echo "[4/5] Patching app/api/items.py (queue endpoint pagination guard)..."
ITEMS_FILE="$REPO_ROOT/app/api/items.py"

if grep -q "PERF FIX: queue limit" "$ITEMS_FILE"; then
  echo "      already patched — skipping"
else
  cp "$ITEMS_FILE" "${ITEMS_FILE}.bak"
  python3 - <<'PYEOF'
path = "app/api/items.py"
with open(path, "r") as f:
    content = f.read()

OLD = '''@router.get("/queue")
def items_queue() -> JSONResponse:
    from app.main import db
    return JSONResponse(db.get_queue())'''

NEW = '''@router.get("/queue")
def items_queue(limit: int = Query(default=100, ge=1, le=500)) -> JSONResponse:
    # PERF FIX: queue limit — previously unbounded, could dump entire table as JSON
    from app.main import db
    rows = db.get_queue()
    return JSONResponse(rows[:limit])'''

if OLD in content:
    content = content.replace(OLD, NEW, 1)
    with open(path, "w") as f:
        f.write(content)
    print("      done  (backup saved as app/api/items.py.bak)")
else:
    print("      WARNING: anchor text not found — skipping items.py patch.")
    print("      Manually add a limit slice to the /queue endpoint.")
PYEOF
fi

# ── 5. render.yaml — keep-alive cron job ──────────────────────────────────────
echo "[5/5] Patching render.yaml (keep-alive cron job)..."
RENDER_FILE="$REPO_ROOT/render.yaml"

if grep -q "keep-alive" "$RENDER_FILE"; then
  echo "      already patched — skipping"
else
  cp "$RENDER_FILE" "${RENDER_FILE}.bak"

  # Prompt for the public URL
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────┐"
  echo "  │  What is your app's public Render URL?                      │"
  echo "  │  (e.g. https://codex-research-radar.onrender.com)           │"
  echo "  └─────────────────────────────────────────────────────────────┘"
  read -rp "  URL: " APP_URL

  if [ -z "$APP_URL" ]; then
    APP_URL="https://YOUR_APP.onrender.com"
    echo "  No URL entered — placeholder used. Edit render.yaml manually."
  fi

  cat >> "$RENDER_FILE" <<YAMLEOF

  # PERF FIX: keep-alive cron — pings /healthz every 14 minutes so Render
  # never spins the service down on the starter plan. Cold starts were causing
  # 30-90 second first-load delays.
  - type: cron
    name: keep-alive-ping
    runtime: image
    image:
      url: docker.io/curlimages/curl:latest
    schedule: "*/14 * * * *"
    startCommand: "curl -fsS ${APP_URL}/healthz"
YAMLEOF

  echo "      done  (backup saved as render.yaml.bak)"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  All patches applied."
echo ""
echo "  Next steps:"
echo "  1. git diff          — review every change"
echo "  2. git add -p        — stage selectively"
echo "  3. git commit -m 'perf: reduce cold-start latency and add missing DB indexes'"
echo "  4. git push          — Render will auto-deploy"
echo ""
echo "  Expected improvements after deploy:"
echo "  • No more cold-start spin-down (keep-alive cron)"
echo "  • Faster async I/O (uvloop)"
echo "  • Faster filtered browse queries (idx_items_ai_summary, idx_items_theme)"
echo "  • Queue endpoint is now bounded (max 500 rows)"
echo "═══════════════════════════════════════════════════════"
echo ""
