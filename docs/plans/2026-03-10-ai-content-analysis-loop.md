# AI Content Analysis Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the screenshot and text research pipelines so visual captures feed the AI hypothesis engine, screenshot terms drive text crawls, and the visual term library is expanded with 15 new terms.

**Architecture:** (1) 15 new explicit terms added to `screenshot.py` + `MediaPage.tsx`. (2) Three new research themes added to `config.py` so the text crawl covers screenshot-adjacent topics. (3) After each capture run, `ingest_screenshots_as_items()` converts per-term screenshot counts into `source_type="visual_capture"` rows in the items table, which the hypothesis engine already reads. (4) AI system prompt updated with one line to interpret visual evidence correctly.

**Tech Stack:** Python 3.11 (FastAPI, SQLite), TypeScript/React 19, existing `app/ai.py` OpenAI-compatible client, no new dependencies.

---

### Task 1: Add 15 new screenshot terms

**Files:**
- Modify: `app/sources/screenshot.py` (TERM_QUERIES and TERM_VIDEO_QUERIES dicts)
- Modify: `frontend/src/features/images/MediaPage.tsx` (TERMS array)

**Context:** `screenshot.py` has two dicts: `TERM_QUERIES` (display term → DDG query) and `TERM_VIDEO_QUERIES` (display term → Redgifs query). `MediaPage.tsx` has a `TERMS` constant array of all display terms. Both must stay in sync.

**Step 1: Add to TERM_QUERIES in screenshot.py**

Add these 15 entries after the existing `"dick"` entry:

```python
    "anal":                  "gay anal sex male",
    "rimjob":                "gay rimjob male",
    "bareback":              "bareback gay male",
    "cum shot":              "gay cum shot male",
    "edging":                "male edging gay orgasm",
    "ruined orgasm":         "ruined orgasm gay male",
    "frottage":              "frottage gay male",
    "69":                    "69 gay male oral",
    "jockstrap":             "jockstrap gay male",
    "muscle gay":            "muscle gay male nude",
    "daddy":                 "gay daddy male",
    "bear":                  "bear gay male",
    "balls":                 "gay male balls scrotum",
    "perineum":              "male perineum anatomy gay",
    "mutual masturbation":   "mutual masturbation gay male",
```

**Step 2: Add to TERM_VIDEO_QUERIES in screenshot.py**

Add these 15 entries after the existing `"dick"` entry:

```python
    "anal":                  "gay anal",
    "rimjob":                "gay rimjob",
    "bareback":              "bareback gay",
    "cum shot":              "gay cumshot",
    "edging":                "edging gay male",
    "ruined orgasm":         "ruined orgasm gay",
    "frottage":              "frottage gay",
    "69":                    "69 gay",
    "jockstrap":             "jockstrap gay",
    "muscle gay":            "muscle gay",
    "daddy":                 "gay daddy",
    "bear":                  "bear gay",
    "balls":                 "gay balls",
    "perineum":              "perineum gay male",
    "mutual masturbation":   "mutual masturbation gay",
```

**Step 3: Update TERMS in MediaPage.tsx**

Replace the existing `TERMS` array with:

```typescript
const TERMS = [
  "penis", "cock", "hyperspermia", "ejaculate", "twink", "twunk",
  "foreskin", "precum", "men docking", "gay orgasm", "hung penis",
  "blowjob", "prostate orgasm", "hands free cum", "gay cum",
  "hands free orgasm", "dick",
  "anal", "rimjob", "bareback", "cum shot", "edging", "ruined orgasm",
  "frottage", "69", "jockstrap", "muscle gay", "daddy", "bear",
  "balls", "perineum", "mutual masturbation",
]
```

**Step 4: Verify term count parity**

Run:
```bash
python3 -c "
from app.sources.screenshot import TERM_QUERIES, TERM_VIDEO_QUERIES
assert set(TERM_QUERIES) == set(TERM_VIDEO_QUERIES), 'Mismatch!'
print(f'OK: {len(TERM_QUERIES)} terms in both dicts')
"
```
Expected: `OK: 32 terms in both dicts`

**Step 5: Build frontend**

```bash
cd frontend && npm run build
```
Expected: `✓ built in Xs` with no errors.

**Step 6: Commit**

```bash
git add app/sources/screenshot.py frontend/src/features/images/MediaPage.tsx app/static/dist/
git commit -m "feat: add 15 new explicit screenshot terms"
```

---

### Task 2: Add 3 new research themes to config

**Files:**
- Modify: `app/config.py` (themes list, lines 64–107)

**Context:** `settings.themes` is a `list[Theme]`. Each `Theme` has `slug`, `label`, and `queries` (list of search strings used by ALL text sources: DDG, Reddit, PubMed, arXiv, etc.). New themes get crawled automatically on the next run.

**Step 1: Add the three new Theme objects**

Inside the `default_factory=lambda: [...]` list in `config.py`, append after the existing `orgasm` theme:

```python
            Theme(
                slug="penile_anatomy",
                label="Penile anatomy and sensation",
                queries=[
                    "penile anatomy male pleasure sensitivity",
                    "foreskin intact sensitivity male sexuality",
                ],
            ),
            Theme(
                slug="ejaculation_physiology",
                label="Ejaculation and seminal fluid physiology",
                queries=[
                    "male ejaculation physiology autonomic",
                    "seminal emission hyperspermia semen volume",
                ],
            ),
            Theme(
                slug="sexual_acts_physiology",
                label="Physiology of male sexual acts",
                queries=[
                    "prostate stimulation male orgasm physiology",
                    "fellatio oral sex male arousal physiology",
                ],
            ),
```

**Step 2: Verify themes load**

```bash
python3 -c "
from app.config import settings
slugs = [t.slug for t in settings.themes]
assert 'penile_anatomy' in slugs
assert 'ejaculation_physiology' in slugs
assert 'sexual_acts_physiology' in slugs
print('OK:', slugs)
"
```
Expected: prints 8 slugs including the 3 new ones.

**Step 3: Commit**

```bash
git add app/config.py
git commit -m "feat: add penile_anatomy, ejaculation_physiology, sexual_acts_physiology themes"
```

---

### Task 3: Add upsert_visual_capture_item to Database

**Files:**
- Modify: `app/db.py` (add one method after `insert_screenshot`)

**Context:** The items table has a `UNIQUE` constraint on `url`. Visual capture items use a synthetic URL like `visual://ddg/penis` so each term+source combo upserts cleanly. `last_run_id` is nullable so we can omit it. We need a dedicated method because `upsert_item()` requires `run_id: int`.

**Step 1: Add method to Database class**

After the `insert_screenshot` method (~line 810), add:

```python
    def upsert_visual_capture_item(self, item: dict[str, Any]) -> None:
        """Insert or replace a visual_capture summary item (no run_id required)."""
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO items (
                    source_type, theme, query, title, url, summary, content, author,
                    published_at, domain, image_url, score, compounds_json, mechanisms_json,
                    metadata_json, first_seen_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    summary = excluded.summary,
                    score = excluded.score,
                    last_seen_at = excluded.last_seen_at
                """,
                (
                    item["source_type"],
                    item["theme"],
                    item["query"],
                    item["title"],
                    item["url"],
                    item["summary"],
                    item.get("content", ""),
                    item.get("author", ""),
                    item.get("published_at", ""),
                    item["domain"],
                    item.get("image_url", ""),
                    item["score"],
                    "[]",
                    "[]",
                    "{}",
                    now,
                    now,
                ),
            )
            conn.commit()
```

**Step 2: Verify the method exists and works**

```bash
python3 -c "
from pathlib import Path
from app.db import Database
import tempfile, os
db = Database(Path(tempfile.mktemp(suffix='.db')))
db.init()
db.upsert_visual_capture_item({
    'source_type': 'visual_capture',
    'theme': 'erections',
    'query': 'visual://ddg/penis',
    'title': 'Visual evidence: penis (DDG)',
    'url': 'visual://ddg/penis',
    'summary': '20 images collected.',
    'domain': 'visual.ddg',
    'score': 1.0,
})
items = db.get_recent_items(limit=5)
assert any(i['source_type'] == 'visual_capture' for i in items)
print('OK: visual_capture item inserted and retrieved')
"
```
Expected: `OK: visual_capture item inserted and retrieved`

**Step 3: Commit**

```bash
git add app/db.py
git commit -m "feat: add upsert_visual_capture_item to Database"
```

---

### Task 4: Add ingest_screenshots_as_items function

**Files:**
- Modify: `app/sources/screenshot.py` (add function at end of file)

**Context:** This function queries the screenshots table for all captured records, groups by (term, source), counts them, computes a density label and score, then calls `db.upsert_visual_capture_item()` for each group. The term→theme mapping covers all 32 terms.

**Step 1: Add TERM_TO_THEME mapping and ingest function**

Add at the end of `app/sources/screenshot.py`:

```python
# ── Term → research theme mapping ────────────────────────────────────────────

TERM_TO_THEME: dict[str, str] = {
    "penis":               "erections",
    "cock":                "erections",
    "dick":                "erections",
    "hung penis":          "erections",
    "foreskin":            "penile_anatomy",
    "balls":               "penile_anatomy",
    "perineum":            "penile_anatomy",
    "twink":               "erections",
    "twunk":               "erections",
    "jockstrap":           "erections",
    "ejaculate":           "ejaculation_latency",
    "precum":              "ejaculation_latency",
    "hyperspermia":        "ejaculation_latency",
    "gay cum":             "ejaculation_latency",
    "hands free cum":      "ejaculation_latency",
    "hands free orgasm":   "ejaculation_latency",
    "cum shot":            "ejaculation_latency",
    "edging":              "ejaculation_latency",
    "gay orgasm":          "orgasm",
    "prostate orgasm":     "orgasm",
    "ruined orgasm":       "orgasm",
    "blowjob":             "sexual_acts_physiology",
    "men docking":         "sexual_acts_physiology",
    "anal":                "sexual_acts_physiology",
    "rimjob":              "sexual_acts_physiology",
    "bareback":            "sexual_acts_physiology",
    "frottage":            "sexual_acts_physiology",
    "69":                  "sexual_acts_physiology",
    "mutual masturbation": "sexual_acts_physiology",
    "muscle gay":          "libido",
    "daddy":               "libido",
    "bear":                "libido",
}


def ingest_screenshots_as_items(db) -> int:
    """
    Summarise screenshot counts per (term, source) and upsert them as
    source_type='visual_capture' items so the hypothesis engine can reason
    across visual and textual evidence.

    Returns the number of items upserted.
    """
    from collections import defaultdict

    # Read all screenshot records
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT term, source, COUNT(*) as cnt FROM screenshots GROUP BY term, source"
        ).fetchall()

    if not rows:
        return 0

    count = 0
    for row in rows:
        term = row["term"]
        source = row["source"]
        cnt = row["cnt"]

        theme = TERM_TO_THEME.get(term, "libido")
        density = "High" if cnt >= 15 else "Moderate" if cnt >= 8 else "Low"
        source_label = "DuckDuckGo" if source == "ddg" else "Redgifs" if source == "redgifs" else source
        media_type = "images" if source == "ddg" else "video clips"

        item = {
            "source_type": "visual_capture",
            "theme": theme,
            "query": f"visual://{source}/{term}",
            "title": f"Visual evidence: {term} ({source_label})",
            "url": f"visual://{source}/{term}",
            "summary": (
                f"{cnt} {media_type} collected for '{term}' via {source_label}. "
                f"Gay male content. {density} visual documentation density."
            ),
            "domain": f"visual.{source}",
            "score": min(1.0, cnt / 20.0),
        }
        db.upsert_visual_capture_item(item)
        count += 1

    return count
```

**Step 2: Verify the function runs**

```bash
python3 -c "
from app.config import settings
from app.db import Database
from app.sources.screenshot import ingest_screenshots_as_items
db = Database(settings.database_path)
db.init()
n = ingest_screenshots_as_items(db)
print(f'OK: {n} visual_capture items upserted')
"
```
Expected: `OK: N visual_capture items upserted` (N = number of distinct term+source combos in your DB, could be 0 if no screenshots yet, which is also fine).

**Step 3: Commit**

```bash
git add app/sources/screenshot.py
git commit -m "feat: add ingest_screenshots_as_items with TERM_TO_THEME mapping"
```

---

### Task 5: Call ingest after capture in screenshots API

**Files:**
- Modify: `app/api/screenshots.py` (update `_run_capture`)

**Context:** `_run_capture(app_state)` already loops over `capture_screenshots()` and inserts rows. We add one call at the end to run `ingest_screenshots_as_items(db)`.

**Step 1: Update _run_capture**

Replace the existing `_run_capture` function body in `app/api/screenshots.py`:

```python
def _run_capture(app_state):
    """Run in thread — sync."""
    from app.sources.screenshot import capture_screenshots, ingest_screenshots_as_items
    db = app_state.db
    image_dir = Path(app_state.settings.image_dir).parent / "screenshots"
    captured = 0
    for result in capture_screenshots(image_dir):
        if result["ok"]:
            db.insert_screenshot(
                term=result["term"],
                source=result["source"],
                page_url=result["page_url"],
                local_path=result["local_path"],
            )
            captured += 1
    ingested = ingest_screenshots_as_items(db)
    print(f"[screenshots] capture complete: {captured} new, {ingested} visual items upserted")
    return captured
```

**Step 2: Commit**

```bash
git add app/api/screenshots.py
git commit -m "feat: call ingest_screenshots_as_items after each capture run"
```

---

### Task 6: Update AI system prompt for visual_capture items

**Files:**
- Modify: `app/ai.py` (SYSTEM_PROMPT constant, lines 14–39)

**Context:** The current prompt says to use only evidence present in provided items and to prefer human male evidence. We add one rule so the model understands the new source type.

**Step 1: Add visual_capture rule to SYSTEM_PROMPT**

In `app/ai.py`, inside `SYSTEM_PROMPT`, add this line after the existing rule about animal evidence (after the line ending `"...unless they are clearly framed as low-confidence mechanistic leads with direct human relevance."`):

```
- visual_capture items are observational prevalence signals derived from automated image/video collection; treat them as evidence of topic accessibility and community salience, not clinical data. Do not cite them as medical or scientific sources.
```

The updated rules block should look like:

```python
SYSTEM_PROMPT = """You are generating research hypotheses from scraped public literature and anecdotal reports.
Your job is to propose strict, source-grounded research leads for expert review.

Rules:
- Use only the evidence present in the provided items.
- Prefer hypotheses supported by converging signals across at least 2 sources or across literature plus anecdotal reports.
- Prefer adult human male evidence. Do not center animal-only, avian, or purely in-vitro leads unless they are clearly framed as low-confidence mechanistic leads with direct human relevance.
- visual_capture items are observational prevalence signals derived from automated image/video collection; treat them as evidence of topic accessibility and community salience, not clinical data. Do not cite them as medical or scientific sources.
- Avoid obvious restatements of standard-of-care or already-mainstream mechanisms unless the evidence suggests a specific unresolved angle.
- Do not provide dosing, procurement advice, self-experiment instructions, rankings of compounds for use, or direct treatment recommendations.
- Do not invent studies, outcomes, biomarkers, or source titles.
- Be conservative: if evidence is weak, say so explicitly in safety_flags.
- novelty_score must be a number from 0.0 to 1.0.
- Return at most 6 hypotheses.
..."""
```

**Step 2: Verify SYSTEM_PROMPT contains the new rule**

```bash
python3 -c "
from app.ai import SYSTEM_PROMPT
assert 'visual_capture' in SYSTEM_PROMPT
print('OK: visual_capture rule present')
"
```
Expected: `OK: visual_capture rule present`

**Step 3: Commit**

```bash
git add app/ai.py
git commit -m "feat: teach hypothesis AI to interpret visual_capture evidence signals"
```

---

### Task 7: Rebuild frontend and end-to-end smoke test

**Files:**
- Build: `frontend/` → `app/static/dist/`

**Step 1: Build frontend**

```bash
cd frontend && npm run build
```
Expected: `✓ built in Xs`, 0 errors.

**Step 2: Restart backend**

```bash
# Kill existing uvicorn if running, then:
cd "/Users/chasebauman/Documents/App research codex" && uvicorn app.main:app --port 8000 --reload &
```

**Step 3: Verify new terms in Images view**

Open the app at `http://localhost:8000`. Click "Images" in sidebar.
Confirm: term pill chips include `anal`, `rimjob`, `bareback`, `cum shot`, `edging`, `ruined orgasm`, `frottage`, `69`, `jockstrap`, `muscle gay`, `daddy`, `bear`, `balls`, `perineum`, `mutual masturbation`.

**Step 4: Verify new themes in config**

```bash
curl -s http://localhost:8000/api/dashboard | python3 -m json.tool | grep -E "penile_anatomy|ejaculation_physiology|sexual_acts_physiology"
```
Expected: the three new slugs appear in the dashboard themes list.

**Step 5: Verify visual_capture items after a capture run**

Trigger a capture:
```bash
curl -s -X POST http://localhost:8000/api/screenshots/capture
```
Wait ~2 minutes for it to complete, then check:
```bash
curl -s "http://localhost:8000/api/items?source_type=visual_capture&limit=5" | python3 -m json.tool
```
Expected: items with `"source_type": "visual_capture"` appear.

**Step 6: Commit build artifacts**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add app/static/dist/
git commit -m "build: rebuild frontend with 15 new screenshot terms"
```
