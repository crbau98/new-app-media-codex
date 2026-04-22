from __future__ import annotations

import requests

from app.config import Settings, Theme
from app.models import ResearchItem
from app.sources.base import (
    clean_text,
    extract_terms,
    score_item,
)


def collect_literature(session: requests.Session, settings: Settings, theme: Theme, query: str) -> list[ResearchItem]:
    response = session.get(
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        params={
            "query": query,
            "format": "json",
            "resultType": "core",
            "pageSize": settings.per_query_limit,
        },
        timeout=settings.request_timeout_seconds,
    )
    response.raise_for_status()
    results = response.json().get("resultList", {}).get("result", [])
    items: list[ResearchItem] = []
    for row in results:
        title = clean_text(row.get("title") or "")
        abstract = clean_text(row.get("abstractText") or "")
        if not title:
            continue
        content = abstract or (row.get("authorString") or "")
        compounds, mechanisms = extract_terms(f"{title}\n{abstract}")
        article_url = row.get("doi")
        if article_url:
            article_url = f"https://doi.org/{article_url}"
        elif row.get("pmid"):
            article_url = f"https://pubmed.ncbi.nlm.nih.gov/{row['pmid']}/"
        else:
            article_url = row.get("fullTextUrlList", {}).get("fullTextUrl", [{}])[0].get("url") or row.get("source")
        items.append(
            ResearchItem(
                source_type="literature",
                theme=theme.slug,
                query=query,
                title=title,
                url=article_url or f"https://europepmc.org/article/{row.get('source', 'MED')}/{row.get('id', '')}",
                summary=abstract or "No abstract available from Europe PMC.",
                content=content,
                author=row.get("authorString", ""),
                published_at=row.get("firstPublicationDate", ""),
                domain="europepmc.org",
                image_url="",
                score=score_item(theme, f"{title}\n{abstract}", compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata={
                    "journal": row.get("journalTitle", ""),
                    "doi": row.get("doi", ""),
                    "pmid": row.get("pmid", ""),
                    "source": row.get("source", ""),
                },
            )
        )
    return items
