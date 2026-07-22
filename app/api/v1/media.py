"""Reference implementation of the v1 conventions (blueprint section 5):
cursor pagination, allow-listed filters, problem-details errors, ETag
conditional GET. New v1 routers copy this shape.

Transport only: no SQL, no business rules beyond DTO mapping — those live
in repositories/services/domain.
"""

from __future__ import annotations

import asyncio
import hashlib
import json

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from app.api.deps import get_media_repository
from app.core.errors import ApiProblem
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, PageInfo, build_page
from app.domain.media import MediaItem, MediaKind, SourceProvider
from app.repositories.media import SqliteMediaRepository

router = APIRouter(prefix="/media", tags=["media"])


class SourceRefDTO(BaseModel):
    provider: str
    external_id: str
    canonical_url: str


class MediaItemDTO(BaseModel):
    id: str
    kind: str
    title: str
    tags: list[str]
    source: SourceRefDTO
    thumbnail_url: str | None
    checksum: str | None
    captured_at: str

    @classmethod
    def from_item(cls, item: MediaItem) -> "MediaItemDTO":
        return cls(
            id=item.id,
            kind=str(item.kind),
            title=item.title,
            tags=item.tags,
            source=SourceRefDTO(
                provider=str(item.source.provider),
                external_id=item.source.external_id,
                canonical_url=item.source.canonical_url,
            ),
            thumbnail_url=item.preview.thumbnail_url,
            checksum=item.checksum,
            captured_at=item.captured_at,
        )


@router.get("", response_model=Page[MediaItemDTO], operation_id="listMedia")
async def list_media(
    kind: MediaKind | None = Query(default=None, description="Filter by media kind"),
    provider: SourceProvider | None = Query(default=None, description="Filter by source provider"),
    tag: str | None = Query(default=None, max_length=64),
    q: str | None = Query(default=None, max_length=200, description="Title search"),
    cursor: str | None = Query(default=None, description="Opaque cursor from page.next_cursor"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    repo: SqliteMediaRepository = Depends(get_media_repository),
) -> Page[MediaItemDTO]:
    # Repository is sync SQLite: run in the threadpool so a slow query never
    # stalls the event loop (audit finding: blocking I/O on the loop).
    items = await asyncio.to_thread(
        repo.list, kind=kind, provider=provider, tag=tag, query=q, cursor=cursor, limit=limit
    )
    page: Page[MediaItem] = build_page(items, limit, lambda item: (item.captured_at, item.id))
    return Page(
        data=[MediaItemDTO.from_item(item) for item in page.data],
        page=PageInfo(next_cursor=page.page.next_cursor, has_more=page.page.has_more),
    )


@router.get("/{media_id}", response_model=MediaItemDTO, operation_id="getMedia")
async def get_media(
    media_id: str,
    request: Request,
    repo: SqliteMediaRepository = Depends(get_media_repository),
) -> Response:
    item = await asyncio.to_thread(repo.get, media_id)
    if item is None:
        raise ApiProblem.not_found("Media item", f"No media item with id {media_id!r}.")

    dto = MediaItemDTO.from_item(item)
    body = dto.model_dump_json().encode("utf-8")
    etag = '"' + hashlib.sha256(body).hexdigest()[:32] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return JSONResponse(
        content=json.loads(body),
        headers={"ETag": etag, "Cache-Control": "private, max-age=30"},
    )
