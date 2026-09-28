"""SSRF-safe outbound HTTP for ingestion.

Guarantees, enforced at connect time (so DNS rebinding cannot bypass them):

* scheme allow-list (http/https), no embedded credentials, port allow-list
* every resolved address must be globally routable (no loopback, private,
  link-local, CGNAT, multicast, metadata, or IPv4-embedded-in-IPv6 tricks)
* the socket connects to the *same* address that was validated
* redirects are followed manually and each hop is re-validated
* hard caps on response bytes, redirect count and wall-clock time
* the process proxy environment is ignored so the check cannot be sidestepped
"""

from __future__ import annotations

import ipaddress
import os
import re
import socket
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.poolmanager import PoolManager

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 MediaCodexIngest/1.0"
)
DEFAULT_ALLOWED_PORTS = frozenset({80, 443, 8080, 8443})
BLOCKED_HOST_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home.arpa", ".corp")
BLOCKED_HOSTS = frozenset({"localhost", "metadata.google.internal", "metadata"})
MAX_REDIRECTS = 5


class UnsafeUrlError(ValueError):
    """Raised when a URL or resolved address fails the SSRF policy."""

    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code


class FetchError(RuntimeError):
    """Network/HTTP failure that is not a policy violation."""

    def __init__(self, code: str, message: str | None = None, status: int | None = None):
        super().__init__(message or code)
        self.code = code
        self.status = status


def _allow_private() -> bool:
    return os.getenv("MEDIA_INGEST_ALLOW_PRIVATE", "").strip().lower() in {"1", "true", "yes"}


def _allowed_ports() -> frozenset[int]:
    raw = os.getenv("MEDIA_INGEST_ALLOWED_PORTS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_PORTS
    try:
        return frozenset(int(p) for p in raw.split(",") if p.strip())
    except ValueError:
        return DEFAULT_ALLOWED_PORTS


_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_SIX_TO_FOUR = ipaddress.ip_network("2002::/16")


def is_public_ip(value: str | ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    try:
        ip = ipaddress.ip_address(value) if isinstance(value, str) else value
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return is_public_ip(ip.ipv4_mapped)
        if ip in _NAT64:
            return is_public_ip(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
        if ip in _SIX_TO_FOUR:
            return is_public_ip(ipaddress.IPv4Address((int(ip) >> 80) & 0xFFFFFFFF))
    if ip.is_multicast or ip.is_unspecified or ip.is_loopback or ip.is_link_local:
        return False
    if ip.is_private or ip.is_reserved:
        return False
    return bool(ip.is_global)


_NUMERIC_HOST = re.compile(r"^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}$", re.I)


def _literal_ip(host: str):
    """Parse IP literals including legacy inet_aton forms (2130706433, 0x7f.1)."""
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass
    if _NUMERIC_HOST.match(host):
        try:
            return ipaddress.IPv4Address(socket.inet_ntoa(socket.inet_aton(host)))
        except (OSError, ValueError):
            return ipaddress.IPv4Address("0.0.0.0")  # unparsable numeric host: treat as blocked
    return None


@dataclass(frozen=True)
class SafeUrl:
    url: str
    scheme: str
    host: str
    port: int


def validate_url(raw: str) -> SafeUrl:
    """Syntactic policy check (no DNS). Raises UnsafeUrlError."""
    if not isinstance(raw, str) or not raw.strip():
        raise UnsafeUrlError("url_required")
    raw = raw.strip()
    if len(raw) > 4096 or any(ch in raw for ch in "\r\n\t\x00"):
        raise UnsafeUrlError("invalid_url")
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as exc:
        raise UnsafeUrlError("invalid_url") from exc
    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"}:
        raise UnsafeUrlError("unsupported_protocol")
    if parts.username or parts.password:
        raise UnsafeUrlError("credentials_not_allowed")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise UnsafeUrlError("invalid_url")
    effective_port = port or (443 if scheme == "https" else 80)
    if not _allow_private():
        if host in BLOCKED_HOSTS or host.endswith(BLOCKED_HOST_SUFFIXES):
            raise UnsafeUrlError("private_host_blocked")
        literal = _literal_ip(host)
        if literal is not None and not is_public_ip(literal):
            raise UnsafeUrlError("private_host_blocked")
        if effective_port not in _allowed_ports():
            raise UnsafeUrlError("port_not_allowed")
    return SafeUrl(url=raw, scheme=scheme, host=host, port=effective_port)


def resolve_public(host: str, port: int) -> list[tuple]:
    """Resolve host and require every answer to be public."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise FetchError("dns_failure", f"could not resolve {host}") from exc
    if not infos:
        raise FetchError("dns_failure", f"could not resolve {host}")
    if not _allow_private():
        for info in infos:
            if not is_public_ip(info[4][0]):
                raise UnsafeUrlError("private_host_blocked", f"{host} resolves to a non-public address")
    return infos


def safe_create_connection(address, timeout=None, source_address=None, socket_options=None):
    """Resolve, validate and connect to the *validated* address."""
    host, port = address
    host = str(host).strip("[]")
    infos = resolve_public(host, int(port))
    last_error: Exception | None = None
    for family, socktype, proto, _canon, sockaddr in infos:
        sock = None
        try:
            sock = socket.socket(family, socktype, proto)
            for opt in socket_options or ():
                sock.setsockopt(*opt)
            if isinstance(timeout, (int, float)):
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
            return sock
        except OSError as exc:
            last_error = exc
            if sock is not None:
                sock.close()
    raise last_error or FetchError("connect_failed")


class _SafeHTTPConnection(HTTPConnection):
    def _new_conn(self):  # type: ignore[override]
        return safe_create_connection(
            (self._dns_host, self.port), self.timeout, self.source_address, self.socket_options
        )


class _SafeHTTPSConnection(HTTPSConnection):
    def _new_conn(self):  # type: ignore[override]
        return safe_create_connection(
            (self._dns_host, self.port), self.timeout, self.source_address, self.socket_options
        )


class _SafeHTTPPool(HTTPConnectionPool):
    ConnectionCls = _SafeHTTPConnection


class _SafeHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = _SafeHTTPSConnection


class _SafeAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        super().init_poolmanager(connections, maxsize, block=block, **pool_kwargs)
        self.poolmanager.pool_classes_by_scheme = {"http": _SafeHTTPPool, "https": _SafeHTTPSPool}


def build_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False  # never inherit HTTP(S)_PROXY / netrc
    adapter = _SafeAdapter(max_retries=0, pool_connections=4, pool_maxsize=4)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


@dataclass
class FetchResult:
    url: str
    status: int
    headers: dict[str, str]
    body: bytes
    truncated: bool = False
    redirects: list[str] = field(default_factory=list)
    content_length: int | None = None

    @property
    def content_type(self) -> str:
        return (self.headers.get("content-type") or "").split(";", 1)[0].strip().lower()

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


def _total_from_content_range(value: str | None) -> int | None:
    if not value or "/" not in value:
        return None
    tail = value.rsplit("/", 1)[1].strip()
    return int(tail) if tail.isdigit() else None


def _open_stream(
    url: str,
    *,
    method: str,
    headers: dict[str, str] | None,
    timeout: float,
    deadline: float,
    max_redirects: int,
    range_bytes: int | None,
    sess: requests.Session,
) -> tuple[requests.Response, str, list[str]]:
    """Open a streaming response, following redirects manually with the SSRF
    policy re-applied on every hop. Caller must close the response."""
    req_headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate",
    }
    if headers:
        req_headers.update(headers)
    if range_bytes:
        req_headers["Range"] = f"bytes=0-{max(0, range_bytes - 1)}"
    current = url
    chain: list[str] = []
    for _hop in range(max_redirects + 1):
        validate_url(current)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise FetchError("timeout", "overall fetch deadline exceeded")
        step_timeout = max(0.5, min(timeout, remaining))
        try:
            resp = sess.request(
                method,
                current,
                headers=req_headers,
                timeout=(step_timeout, step_timeout),
                allow_redirects=False,
                stream=True,
            )
        except (UnsafeUrlError, FetchError):
            raise
        except requests.exceptions.Timeout as exc:
            raise FetchError("timeout", str(exc)) from exc
        except requests.exceptions.SSLError as exc:
            raise FetchError("tls_error", str(exc)) from exc
        except requests.exceptions.RequestException as exc:
            cause = exc.__cause__ or exc.__context__
            while cause is not None and not isinstance(cause, UnsafeUrlError):
                cause = cause.__cause__ or cause.__context__
            if isinstance(cause, UnsafeUrlError):
                raise cause from exc
            raise FetchError("connect_failed", str(exc)) from exc
        if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
            chain.append(current)
            location = resp.headers["location"]
            resp.close()
            current = urljoin(current, location)
            if method != "HEAD" and resp.status_code == 303:
                method = "GET"
            continue
        return resp, current, chain
    raise FetchError("too_many_redirects", f"more than {max_redirects} redirects")


def safe_fetch(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    max_bytes: int = 512 * 1024,
    timeout: float = 8.0,
    total_timeout: float = 20.0,
    max_redirects: int = MAX_REDIRECTS,
    range_bytes: int | None = None,
    session: requests.Session | None = None,
) -> FetchResult:
    """GET/HEAD `url` under the SSRF policy. Reads at most `max_bytes` (the
    result is flagged `truncated` rather than raising) and never blocks longer
    than `total_timeout` seconds overall."""
    deadline = time.monotonic() + total_timeout
    sess = session or build_session()
    try:
        resp, current, chain = _open_stream(
            url, method=method, headers=headers, timeout=timeout, deadline=deadline,
            max_redirects=max_redirects, range_bytes=range_bytes, sess=sess,
        )
        try:
            body = bytearray()
            truncated = False
            if method != "HEAD":
                for chunk in resp.iter_content(chunk_size=16384):
                    if not chunk:
                        continue
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        del body[max_bytes:]
                        truncated = True
                        break
                    if time.monotonic() > deadline:
                        truncated = True
                        break
            declared = resp.headers.get("content-length")
            total = _total_from_content_range(resp.headers.get("content-range"))
            if total is None and declared and declared.isdigit():
                total = int(declared)
            return FetchResult(
                url=current,
                status=resp.status_code,
                headers={k.lower(): v for k, v in resp.headers.items()},
                body=bytes(body),
                truncated=truncated,
                redirects=chain,
                content_length=total,
            )
        finally:
            resp.close()
    finally:
        if session is None:
            sess.close()


@dataclass
class DownloadResult:
    url: str
    status: int
    content_type: str
    path: str
    size: int
    head: bytes
    redirects: list[str] = field(default_factory=list)


def safe_download(
    url: str,
    dest: str,
    *,
    max_bytes: int,
    timeout: float = 15.0,
    total_timeout: float = 600.0,
    headers: dict[str, str] | None = None,
    on_progress=None,
    should_cancel=None,
    session: requests.Session | None = None,
) -> DownloadResult:
    """Stream a URL to `dest` (never buffering the body in memory) with hard
    size and time caps. Writes to `dest + '.part'` and renames on success;
    partial data is always removed on failure. Raises FetchError with codes
    too_large / timeout / http_error / cancelled."""
    deadline = time.monotonic() + total_timeout
    sess = session or build_session()
    part = dest + ".part"
    try:
        resp, current, chain = _open_stream(
            url, method="GET", headers=headers, timeout=timeout, deadline=deadline,
            max_redirects=MAX_REDIRECTS, range_bytes=None, sess=sess,
        )
        try:
            if not 200 <= resp.status_code < 300:
                raise FetchError("http_error", f"HTTP {resp.status_code}", status=resp.status_code)
            declared = resp.headers.get("content-length")
            total = int(declared) if declared and declared.isdigit() else None
            if total is not None and total > max_bytes:
                raise FetchError("too_large", f"remote file is {total} bytes (limit {max_bytes})")
            size = 0
            head = b""
            try:
                with open(part, "wb") as out:
                    for chunk in resp.iter_content(chunk_size=256 * 1024):
                        if not chunk:
                            continue
                        if not head:
                            head = chunk[:4096]
                        size += len(chunk)
                        if size > max_bytes:
                            raise FetchError("too_large", f"download exceeded {max_bytes} bytes")
                        if time.monotonic() > deadline:
                            raise FetchError("timeout", "download deadline exceeded")
                        if should_cancel is not None and should_cancel():
                            raise FetchError("cancelled", "cancelled")
                        out.write(chunk)
                        if on_progress is not None:
                            on_progress(size, total)
                if size == 0:
                    raise FetchError("empty_response", "the server returned no data")
                os.replace(part, dest)
            except BaseException:
                try:
                    os.unlink(part)
                except OSError:
                    pass
                raise
            return DownloadResult(
                url=current, status=resp.status_code,
                content_type=(resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower(),
                path=dest, size=size, head=head, redirects=chain,
            )
        finally:
            resp.close()
    finally:
        if session is None:
            sess.close()
