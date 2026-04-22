from __future__ import annotations
import requests
from app.config import Settings, Theme
from app.models import ResearchItem
from app.sources.base import extract_signals

RXIVIST_API = "https://api.rxivist.org/v1/papers"

def collect_biorxiv(session: requests.Session, settings: Settings, theme: Theme) -> list[ResearchItem]:
    items: list[ResearchItem] = []
    for query in theme.queries[:1]:  # one query per theme
        try:
            r = session.get(
                RXIVIST_API,
                params={"q": query, "category": "all", "page_size": settings.biorxiv_results},
                timeout=settings.request_timeout_seconds,
            )
            r.raise_for_status()
            results = r.json().get("results", [])
        except Exception:
            continue
        for art in results:
            title = art.get("title", "")
            abstract = art.get("abstract", "")
            doi = art.get("doi", "")
            authors_list = art.get("authors", [])
            if isinstance(authors_list, list) and authors_list:
                author = authors_list[0].get("name", "") if isinstance(authors_list[0], dict) else str(authors_list[0])
            else:
                author = ""
            first_posted = art.get("first_posted", "")
            compounds, mechanisms = extract_signals(title + " " + abstract)
            items.append(ResearchItem(
                source_type="biorxiv", theme=theme.slug, query=query,
                title=title, url=f"https://doi.org/{doi}" if doi else "",
                summary=abstract[:400], content=abstract,
                author=author, published_at=first_posted,
                domain="biorxiv.org", image_url="",
                score=float(len(compounds) + len(mechanisms)),
                compounds=compounds, mechanisms=mechanisms, metadata={"doi": doi},
            ))
    return items
