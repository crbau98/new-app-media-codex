from __future__ import annotations

import json
from collections import Counter, defaultdict
from typing import Any, Iterator

import requests

from app.config import Settings
from app.models import HypothesisRecord


def summarize_topic_signals(items: list[dict[str, Any]]) -> dict[str, Any]:
    from app.sources.base import summarize_topic_signals as _summarize_topic_signals

    return _summarize_topic_signals(items)


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

Output strict JSON only with:
{
  "hypotheses": [
    {
      "title": "... concise and specific ...",
      "rationale": "... why this lead follows from the provided evidence ...",
      "evidence": "... cite 2-4 concrete source titles or domains from the provided items ...",
      "novelty_score": 0.0,
      "safety_flags": "... uncertainty, confounding, and reasons to be cautious ..."
    }
  ]
}"""


def call_model(settings: Settings, payload: dict[str, Any]) -> list[dict[str, Any]]:
    response = requests.post(
        f"{settings.openai_base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.openai_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=True)},
            ],
            "response_format": {"type": "json_object"},
        },
        timeout=settings.request_timeout_seconds * 2,
    )
    response.raise_for_status()
    message = response.json()["choices"][0]["message"]["content"]
    parsed = json.loads(message)
    return [_normalize_hypothesis(item) for item in parsed.get("hypotheses", [])]


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "; ".join(str(part) for part in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=True)
    return str(value)


def _normalize_hypothesis(item: dict[str, Any]) -> dict[str, Any]:
    novelty = item.get("novelty_score", 0.5)
    try:
        novelty_value = float(novelty)
    except (TypeError, ValueError):
        novelty_value = 0.5
    if novelty_value > 1.0 and novelty_value <= 10.0:
        novelty_value = novelty_value / 10.0
    novelty_value = max(0.0, min(1.0, novelty_value))
    return {
        "title": _stringify(item.get("title", "Untitled hypothesis"))[:240],
        "rationale": _stringify(item.get("rationale", "")),
        "evidence": _stringify(item.get("evidence", "")),
        "novelty_score": novelty_value,
        "safety_flags": _stringify(item.get("safety_flags", "")),
    }


def _dedupe_hypotheses(hypotheses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_titles: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for item in hypotheses:
        title_key = item["title"].strip().lower()
        if not title_key or title_key in seen_titles:
            continue
        if len(item["rationale"].strip()) < 40:
            continue
        seen_titles.add(title_key)
        cleaned.append(item)
    return cleaned


def _priority_score(item: dict[str, Any]) -> tuple[int, float]:
    text = " ".join(
        [
            item.get("title", ""),
            item.get("summary", ""),
            item.get("content", ""),
            " ".join(item.get("mechanisms", [])),
            " ".join(item.get("compounds", [])),
        ]
    ).lower()
    human_bonus = 0
    if any(term in text for term in ("human", "men", "male", "patients", "clinical", "trial", "cohort")):
        human_bonus += 3
    if item.get("source_type") == "literature":
        human_bonus += 2
    if any(term in text for term in ("rat", "rats", "mice", "mouse", "murine", "avian", "ostrich")):
        human_bonus -= 3
    if "case report" in text or "review" in text or "meta-analysis" in text:
        human_bonus += 1
    return human_bonus, float(item.get("score", 0))


def select_hypothesis_inputs(items: list[dict[str, Any]], limit: int = 24) -> list[dict[str, Any]]:
    eligible = [
        item
        for item in items
        if item.get("theme") != "community_visuals" and not str(item.get("source_type", "")).endswith("_visual")
    ]
    ranked = sorted(eligible, key=_priority_score, reverse=True)
    selected = ranked[:limit]
    if selected:
        return selected
    return eligible[:limit]


def heuristic_hypotheses(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not items:
        return []
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[item["theme"]].append(item)

    compounds = Counter()
    mechanisms = Counter()
    cross_theme: dict[str, set[str]] = defaultdict(set)
    for item in items:
        for compound in item.get("compounds", []):
            compounds[compound] += 1
            cross_theme[compound].add(item["theme"])
        for mechanism in item.get("mechanisms", []):
            mechanisms[mechanism] += 1

    top_compounds = [name for name, _count in compounds.most_common(6)]
    top_mechanisms = [name for name, _count in mechanisms.most_common(6)]
    signals = summarize_topic_signals(items)
    hypotheses: list[HypothesisRecord] = []

    if top_mechanisms:
        hypotheses.append(
            HypothesisRecord(
                title="Cross-domain mechanism stacking merits prospective study",
                rationale=(
                    "Multiple themes are converging on a small set of mechanisms. A formal program could test "
                    f"whether pairing {', '.join(top_mechanisms[:3])} addresses desire, erection, and orgasm endpoints better than isolated interventions."
                ),
                evidence=f"Top mechanisms in current sources: {', '.join(name for name, _count in signals['mechanisms'][:5])}.",
                novelty_score=0.72,
                safety_flags="Multi-target interventions raise interaction and adverse-effect risk; expert review required.",
            )
        )

    pssd_items = grouped.get("pssd", [])
    if pssd_items:
        pssd_mechanisms = Counter()
        for item in pssd_items:
            pssd_mechanisms.update(item.get("mechanisms", []))
        focus = ", ".join(name for name, _count in pssd_mechanisms.most_common(3)) or "neurosteroid and serotonergic recovery"
        hypotheses.append(
            HypothesisRecord(
                title="Persistent SSRI dysfunction may require recovery-phase biomarker studies",
                rationale=(
                    "The collected PSSD material repeatedly mentions heterogeneous mechanisms rather than a single pathway. "
                    f"A longitudinal design centered on {focus} could test whether persistent sexual dysfunction reflects distinct subtypes."
                ),
                evidence=f"PSSD items collected this cycle: {len(pssd_items)}.",
                novelty_score=0.79,
                safety_flags="Hypothesis only; no causal claim should be inferred from anecdotes.",
            )
        )

    shared_compounds = [name for name in top_compounds if len(cross_theme[name]) >= 2][:3]
    if shared_compounds:
        hypotheses.append(
            HypothesisRecord(
                title="Shared compounds appearing across themes should be prioritized for evidence mapping",
                rationale=(
                    "A small cluster of compounds is showing up in literature and anecdotal discussions across more than one endpoint. "
                    f"Mapping the evidence for {', '.join(shared_compounds)} could reveal whether the overlap reflects genuine cross-endpoint activity or search bias."
                ),
                evidence="Compound overlap calculated from the most recent collected sources.",
                novelty_score=0.61,
                safety_flags="Mention frequency is not evidence of efficacy or safety.",
            )
        )

    anecdote_count = len([item for item in items if item["source_type"] == "anecdote"])
    literature_count = len([item for item in items if item["source_type"] == "literature"])
    hypotheses.append(
        HypothesisRecord(
            title="Anecdote-literature mismatch should be tracked as a frontier signal",
            rationale=(
                "When anecdotal discussion volume outpaces formal literature, it often signals either a genuine unmet need or a noisy online cluster. "
                "A mismatch tracker could highlight targets that deserve formal review."
            ),
            evidence=f"Recent mix: {literature_count} literature items and {anecdote_count} anecdotal items.",
            novelty_score=0.55,
            safety_flags="Online discussion is highly confounded and can amplify unsafe experimentation.",
        )
    )

    return _dedupe_hypotheses([record.__dict__ for record in hypotheses[:5]])


def generate_hypotheses(settings: Settings, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    selected = select_hypothesis_inputs(items, limit=24)
    if not selected:
        return [], {"provider": "none", "error": ""}
    if not settings.openai_api_key:
        return heuristic_hypotheses(selected), {"provider": "heuristic", "error": "OPENAI_API_KEY not configured"}

    payload = {
        "source_count": len(selected),
        "signal_summary": summarize_topic_signals(selected),
        "items": [
            {
                "theme": item["theme"],
                "source_type": item["source_type"],
                "title": item["title"],
                "summary": item["summary"][:600],
                "compounds": item.get("compounds", []),
                "mechanisms": item.get("mechanisms", []),
                "domain": item["domain"],
                "published_at": item.get("published_at", ""),
            }
            for item in selected
        ],
    }
    try:
        hypotheses = _dedupe_hypotheses(call_model(settings, payload))
        if not hypotheses:
            raise ValueError("Model returned no usable hypotheses")
        return hypotheses, {"provider": "openai", "error": ""}
    except Exception as exc:
        return heuristic_hypotheses(selected), {"provider": "heuristic_fallback", "error": str(exc)}


def _build_prompt(items: list[dict[str, Any]]) -> str:
    selected = select_hypothesis_inputs(items, limit=24)
    payload = {
        "source_count": len(selected),
        "signal_summary": summarize_topic_signals(selected),
        "items": [
            {
                "theme": item["theme"],
                "source_type": item["source_type"],
                "title": item["title"],
                "summary": item.get("summary", "")[:600],
                "compounds": item.get("compounds", []),
                "mechanisms": item.get("mechanisms", []),
                "domain": item.get("domain", ""),
                "published_at": item.get("published_at", ""),
            }
            for item in selected
        ],
    }
    return json.dumps(payload, ensure_ascii=True)


def _build_deterministic_hypothesis(items: list[dict[str, Any]]) -> str:
    selected = select_hypothesis_inputs(items, limit=24)
    hypotheses = heuristic_hypotheses(selected)
    if not hypotheses:
        return "No hypothesis could be generated from the available items."
    parts: list[str] = []
    for hyp in hypotheses:
        parts.append(f"## {hyp['title']}\n\n{hyp['rationale']}\n\nEvidence: {hyp['evidence']}\n\nSafety flags: {hyp['safety_flags']}")
    return "\n\n---\n\n".join(parts)


def stream_hypothesis(settings: Any, items: list[dict[str, Any]]) -> Iterator[str]:
    """Yields text chunks for a single hypothesis via SSE."""
    if not settings.openai_api_key:
        yield from _deterministic_stream(items)
        return
    try:
        import openai
        client = openai.OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
        prompt = _build_prompt(items)
        with client.chat.completions.stream(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    yield delta
    except Exception:
        yield from _deterministic_stream(items)


def _deterministic_stream(items: list[dict[str, Any]]) -> Iterator[str]:
    text = _build_deterministic_hypothesis(items)
    for word in text.split():
        yield word + " "
