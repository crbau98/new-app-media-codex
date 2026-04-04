---
name: new-source
description: Scaffold a new research data source collector and wire it fully into the crawl pipeline
---

When the user asks to add a new data source, follow these steps exactly:

## Step 1 — Understand the pattern
Read these files to understand the conventions before writing any code:
- `app/sources/base.py` — extract_signals(), ResearchItem, build_session(), cache_image()
- `app/sources/pubmed.py` — example of a well-structured source with proper error handling
- `app/config.py` — how per-source result limits are declared (e.g. `pubmed_results`)
- `app/service.py` — how sources are imported and called in run_crawl()

## Step 2 — Create the source file
Create `app/sources/<name>.py` following this structure:
```python
def collect_<name>(session, settings, theme) -> list[ResearchItem]:
    items = []
    for query in theme.queries[:2]:  # respect per-query limits
        try:
            # fetch from API/site
            ...
        except Exception:
            continue
        # parse results, call extract_signals(), build ResearchItem objects
        ...
    return items
```

Rules:
- ALL HTTP calls must be wrapped in try/except with `continue` on failure
- Use `extract_signals(title + " " + abstract)` for compound/mechanism extraction
- Use `settings.request_timeout_seconds` for all requests
- Never raise exceptions that bubble up to run_crawl()
- Keep per-source item count bounded by a settings limit

## Step 3 — Add settings
In `app/config.py`, add:
```python
<name>_results: int = int(os.getenv("<NAME>_RESULTS", "5"))
```
And add the env var to `.env.example`:
```
<NAME>_RESULTS=5
```

## Step 4 — Wire into service.py
In `app/service.py`, import the collector and add it to the run_crawl loop:
```python
from app.sources.<name> import collect_<name>

# Inside run_crawl, in the per-theme source loop:
("<name>", collect_<name>),
```

## Step 5 — Update dashboard source list
In `service.py`'s `dashboard_payload()`, add `"<name>"` to the `source_types` list so it appears in the UI filters.

## Step 6 — Verify
Run: `python -m py_compile app/sources/<name>.py app/service.py app/config.py`
Then restart the backend and confirm the new source appears in the Items page source filter.
