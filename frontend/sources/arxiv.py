from __future__ import annotations
import xml.etree.ElementTree as ET
import requests
from app.config import Settings, Theme
from app.models import ResearchItem
from app.sources.base import extract_signals

ARXIV_API = "https://export.arxiv.org/api/query"
NS = "http://www.w3.org/2005/Atom"

def collect_arxiv(session: requests.Session, settings: Settings, theme: Theme) -> list[ResearchItem]:
    items: list[ResearchItem] = []
    for query in theme.queries[:1]:
        params = {"search_query": f"all:{query}", "max_results": settings.arxiv_results, "sortBy": "relevance"}
        try:
            r = session.get(ARXIV_API, params=params, timeout=settings.request_timeout_seconds)
            r.raise_for_status()
            root = ET.fromstring(r.text)
        except Exception:
            continue
        for entry in root.findall(f"{{{NS}}}entry"):
            title = (entry.findtext(f"{{{NS}}}title") or "").strip()
            abstract = (entry.findtext(f"{{{NS}}}summary") or "").strip()
            url = (entry.findtext(f"{{{NS}}}id") or "").strip()
            authors = [a.findtext(f"{{{NS}}}name") or "" for a in entry.findall(f"{{{NS}}}author")]
            published = (entry.findtext(f"{{{NS}}}published") or "")[:10]
            compounds, mechanisms = extract_signals(title + " " + abstract)
            items.append(ResearchItem(
                source_type="arxiv", theme=theme.slug, query=query,
                title=title, url=url, summary=abstract[:400], content=abstract,
                author=", ".join(authors[:2]), published_at=published,
                domain="arxiv.org", image_url="",
                score=float(len(compounds) + len(mechanisms)),
                compounds=compounds, mechanisms=mechanisms, metadata={},
            ))
            if len(items) >= settings.arxiv_results:
                break
    return items
