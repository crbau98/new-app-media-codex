from __future__ import annotations
import time
from typing import Any
import requests
from app.config import Settings, Theme
from app.models import ResearchItem
from app.sources.base import extract_signals

ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
ESUM    = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

def collect_pubmed(
    session: requests.Session,
    settings: Settings,
    theme: Theme,
) -> list[ResearchItem]:
    items: list[ResearchItem] = []
    api_key = settings.pubmed_api_key
    for query in theme.queries:
        params: dict[str, Any] = {
            "db": "pubmed", "term": query, "retmax": settings.pubmed_results,
            "retmode": "json", "sort": "relevance",
        }
        if api_key:
            params["api_key"] = api_key
        try:
            r = session.get(ESEARCH, params=params, timeout=settings.request_timeout_seconds)
            r.raise_for_status()
            ids = r.json().get("esearchresult", {}).get("idlist", [])
        except Exception:
            continue
        if not ids:
            continue
        sum_params: dict[str, Any] = {
            "db": "pubmed", "id": ",".join(ids), "retmode": "json",
        }
        if api_key:
            sum_params["api_key"] = api_key
        try:
            sr = session.get(ESUM, params=sum_params, timeout=settings.request_timeout_seconds)
            sr.raise_for_status()
            result = sr.json().get("result", {})
            uids = result.get("uids", [])
            result_map = result
        except Exception:
            continue
        for uid in uids:
            art = result_map.get(uid, {})
            title = art.get("title", "").strip() or "(no title)"
            authors = art.get("authors", [])
            author = authors[0].get("name", "") if authors else ""
            pub_date = art.get("pubdate", "")
            doi_list = [i.get("value","") for i in art.get("articleids",[]) if i.get("idtype")=="doi"]
            doi = doi_list[0] if doi_list else ""
            url = f"https://pubmed.ncbi.nlm.nih.gov/{uid}/" if not doi else f"https://doi.org/{doi}"
            compounds, mechanisms = extract_signals(title)
            items.append(ResearchItem(
                source_type="pubmed", theme=theme.slug, query=query,
                title=title, url=url, summary=title[:400],
                content="", author=author, published_at=pub_date,
                domain="pubmed.ncbi.nlm.nih.gov", image_url="",
                score=float(len(compounds) + len(mechanisms)),
                compounds=compounds, mechanisms=mechanisms, metadata={"pmid": uid, "doi": doi},
            ))
        time.sleep(0.11)  # NCBI rate limit: ~10 req/s with key, 3/s without
    return items
