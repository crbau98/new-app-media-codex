"""Pure-Python ISO-BMFF (MP4/MOV) top-level box scanner.

Works without ffmpeg/ffprobe: it answers "is moov before mdat (faststart)?"
for local files and can read basic movie metadata (duration, dimensions) out
of the first bytes of a remote file when the moov box is at the front.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Mp4Layout:
    boxes: list[tuple[str, int, int]] = field(default_factory=list)  # (type, offset, size)
    moov_offset: int | None = None
    mdat_offset: int | None = None
    ftyp_major: str | None = None
    complete: bool = False  # scanned the whole file

    @property
    def is_mp4(self) -> bool:
        return self.ftyp_major is not None

    @property
    def faststart(self) -> bool | None:
        """True if moov precedes mdat, False if mdat precedes moov, None if unknown."""
        if self.moov_offset is not None and self.mdat_offset is not None:
            return self.moov_offset < self.mdat_offset
        if self.moov_offset is not None:
            return True
        if self.mdat_offset is not None and self.complete:
            return False
        return None


def scan_layout(path: str | Path, max_boxes: int = 64) -> Mp4Layout:
    layout = Mp4Layout()
    p = Path(path)
    try:
        total = p.stat().st_size
        with p.open("rb") as fh:
            offset = 0
            for _ in range(max_boxes):
                if offset + 8 > total:
                    layout.complete = True
                    break
                fh.seek(offset)
                header = fh.read(16)
                if len(header) < 8:
                    layout.complete = True
                    break
                size, btype = struct.unpack(">I4s", header[:8])
                kind = btype.decode("latin-1")
                if size == 1 and len(header) >= 16:
                    size = struct.unpack(">Q", header[8:16])[0]
                elif size == 0:
                    size = total - offset
                if size < 8:
                    break
                layout.boxes.append((kind, offset, size))
                if kind == "ftyp":
                    fh.seek(offset + 8)
                    layout.ftyp_major = fh.read(4).decode("latin-1")
                elif kind == "moov" and layout.moov_offset is None:
                    layout.moov_offset = offset
                elif kind == "mdat" and layout.mdat_offset is None:
                    layout.mdat_offset = offset
                offset += size
                if offset >= total:
                    layout.complete = True
                    break
    except OSError:
        pass
    return layout


def is_faststart(path: str | Path) -> bool | None:
    layout = scan_layout(path)
    if not layout.is_mp4:
        return None
    return layout.faststart


@dataclass
class Mp4HeadInfo:
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    moov_in_head: bool = False


def _iter_boxes(buf: bytes, start: int, end: int):
    pos = start
    while pos + 8 <= end:
        size, btype = struct.unpack(">I4s", buf[pos : pos + 8])
        header = 8
        if size == 1 and pos + 16 <= end:
            size = struct.unpack(">Q", buf[pos + 8 : pos + 16])[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            return  # truncated (or corrupt) box: nothing beyond it is trustworthy
        yield btype.decode("latin-1"), pos + header, pos + size
        pos += size


def parse_head(buf: bytes) -> Mp4HeadInfo:
    """Parse movie metadata from bytes at the start of a file. Returns partial
    info when moov is not entirely inside `buf`."""
    info = Mp4HeadInfo()
    for kind, body_start, body_end in _iter_boxes(buf, 0, len(buf)):
        if kind != "moov":
            continue
        info.moov_in_head = True
        for ckind, cstart, cend in _iter_boxes(buf, body_start, body_end):
            if ckind == "mvhd" and cend - cstart >= 24:
                version = buf[cstart]
                if version == 1 and cend - cstart >= 32:
                    timescale, duration = struct.unpack(">IQ", buf[cstart + 20 : cstart + 32])
                else:
                    timescale, duration = struct.unpack(">II", buf[cstart + 12 : cstart + 20])
                if timescale:
                    info.duration_seconds = round(duration / timescale, 3)
            elif ckind == "trak":
                for tkind, tstart, tend in _iter_boxes(buf, cstart, cend):
                    if tkind != "tkhd" or tend - tstart < 84:
                        continue
                    version = buf[tstart]
                    off = tstart + (88 if version == 1 else 76)
                    if off + 8 <= tend:
                        w, h = struct.unpack(">II", buf[off : off + 8])
                        w >>= 16
                        h >>= 16
                        if w and h and info.width is None:
                            info.width, info.height = w, h
        break
    return info
