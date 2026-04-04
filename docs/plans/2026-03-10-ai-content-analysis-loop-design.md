# AI Content Analysis Loop Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the screenshot and text research pipelines so that visual captures feed the AI hypothesis engine as first-class evidence, screenshot terms drive text crawls, and the term library is expanded.

**Architecture:** Three changes run in parallel at the data layer — (1) screenshot records are summarised into `source_type="visual_capture"` items in the existing items table, (2) three new research themes derived from screenshot terms are added to `config.py`, (3) ~15 new explicit terms are added to the screenshot pipeline. The hypothesis AI receives updated system-prompt instructions to interpret visual evidence signals.

**Tech Stack:** Python (FastAPI, SQLite), React 19 / TypeScript, TanStack Query v5, existing `app/ai.py` OpenAI-compatible client.

---

## Section 1: Visual captures → Research items

After every screenshot capture run, `ingest_screenshots_as_items()` groups screenshot DB rows by term+source, builds a prose summary per group, and upserts one `ResearchItem` into the items table per group.

**Term → theme mapping:**

| Screenshot term | Research theme |
|---|---|
| penis, cock, dick, hung penis, foreskin, twink, twunk | erections |
| ejaculate, precum, hyperspermia, gay cum, hands free cum, hands free orgasm | ejaculation_latency |
| gay orgasm, prostate orgasm, blowjob, men docking | orgasm |
| libido (fallback for unmapped) | libido |

Item shape:
- `source_type`: `"visual_capture"`
- `title`: `"Visual evidence: {term} ({source})"`
- `summary`: `"{n} images/videos collected for '{term}' via {source}. Gay male content. {'High' if n>=15 else 'Moderate' if n>=8 else 'Low'} visual density."`
- `theme`: mapped value above
- `domain`: `"visual.ddg"` or `"visual.redgifs"`
- `score`: `min(1.0, count / 20.0)`
- `content`, `url`, `compounds`, `mechanisms`: empty/defaults

`app/ai.py` system prompt gains one sentence in the rules section:
> `"visual_capture items are observational prevalence signals — treat them as evidence of topic accessibility and community salience, not clinical data."`

`ingest_screenshots_as_items()` is called at the end of `_run_capture()` in `app/api/screenshots.py`.

## Section 2: Screenshot terms → Text research themes

Three new `Theme` objects added to `settings.themes` in `config.py`:

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

## Section 3: Expanded screenshot terms

15 new terms added to `TERM_QUERIES`, `TERM_VIDEO_QUERIES` in `screenshot.py` and `TERMS` in `MediaPage.tsx`:

| Display term | DDG query | Redgifs query |
|---|---|---|
| anal | gay anal sex male | gay anal |
| rimjob | gay rimjob male | gay rimjob |
| bareback | bareback gay male | bareback gay |
| cum shot | gay cum shot male | gay cumshot |
| edging | male edging gay orgasm | edging gay male |
| ruined orgasm | ruined orgasm gay male | ruined orgasm gay |
| frottage | frottage gay male | frottage gay |
| 69 | 69 gay male oral | 69 gay |
| jockstrap | jockstrap gay male | jockstrap gay |
| muscle gay | muscle gay male nude | muscle gay |
| daddy | gay daddy male | gay daddy |
| bear | bear gay male | bear gay |
| balls | gay male balls scrotum | gay balls |
| perineum | male perineum anatomy gay | perineum gay male |
| mutual masturbation | mutual masturbation gay male | mutual masturbation gay |
