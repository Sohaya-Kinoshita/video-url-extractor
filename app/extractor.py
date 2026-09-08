from __future__ import annotations

import html
import ipaddress
import os
import re
import socket
from dataclasses import asdict, dataclass
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup


VIDEO_EXTENSIONS = ("mp4", "m3u8", "webm", "mov", "m4v", "ogv")
REQUEST_TIMEOUT = 12.0
MAX_HTML_BYTES = 5 * 1024 * 1024

ABSOLUTE_VIDEO_RE = re.compile(
    rf"(?P<url>(?:https?:)?//[^\s\"'<>]+?\.(?:{'|'.join(VIDEO_EXTENSIONS)})(?:\?[^\s\"'<>]*)?)",
    re.IGNORECASE,
)
RELATIVE_VIDEO_RE = re.compile(
    rf"(?P<url>(?:/|\.\.?/)[^\s\"'<>]+?\.(?:{'|'.join(VIDEO_EXTENSIONS)})(?:\?[^\s\"'<>]*)?)",
    re.IGNORECASE,
)

MEDIA_ATTRS = (
    "src",
    "href",
    "data-src",
    "data-url",
    "data-video",
    "data-video-url",
    "data-hls",
    "data-file",
    "content",
)
EMBED_TAGS = {"iframe", "embed", "object"}
DIRECT_MEDIA_TAGS = {"video", "source"}


@dataclass(frozen=True)
class VideoCandidate:
    url: str
    kind: str
    source: str


class ExtractionError(ValueError):
    pass


def validate_fetch_url(url: str) -> str:
    cleaned = url.strip()
    parsed = urlparse(cleaned)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ExtractionError("http または https のURLを入力してください。")

    if os.getenv("ALLOW_PRIVATE_URLS", "").lower() in {"1", "true", "yes"}:
        return cleaned

    hostname = parsed.hostname
    if not hostname:
        raise ExtractionError("URLのホスト名を確認できません。")

    try:
        addresses = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise ExtractionError("ホスト名を解決できませんでした。") from exc

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ExtractionError("公開WebページのURLを入力してください。")

    return cleaned


async def fetch_html(url: str) -> tuple[str, str]:
    safe_url = validate_fetch_url(url)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; VideoURLExtractor/0.1; "
            "+https://example.dev/video-url-extractor)"
        )
    }

    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        follow_redirects=True,
        headers=headers,
    ) as client:
        async with client.stream("GET", safe_url) as response:
            response.raise_for_status()

            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
                raise ExtractionError("HTMLページのURLを入力してください。")

            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > MAX_HTML_BYTES:
                    raise ExtractionError("HTMLが大きすぎるため解析を中止しました。")
                chunks.append(chunk)

    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace"), str(response.url)


def extract_video_urls(html_text: str, page_url: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html_text, "html.parser")
    candidates: list[VideoCandidate] = []

    candidates.extend(_extract_from_media_tags(soup, page_url))
    candidates.extend(_extract_from_metadata(soup, page_url))
    candidates.extend(_extract_from_embeds(soup, page_url))
    candidates.extend(_extract_from_text(html_text, page_url))

    deduped: dict[str, VideoCandidate] = {}
    for candidate in candidates:
        if candidate.url not in deduped:
            deduped[candidate.url] = candidate

    return [asdict(candidate) for candidate in deduped.values()]


def _extract_from_media_tags(soup: BeautifulSoup, page_url: str) -> Iterable[VideoCandidate]:
    for tag in soup.find_all(list(DIRECT_MEDIA_TAGS)):
        tag_name = tag.name or "media"
        is_video_context = tag_name == "video" or tag.find_parent("video") is not None
        declared_type = str(tag.get("type", "")).lower()

        for attr in MEDIA_ATTRS:
            value = tag.get(attr)
            if not value:
                continue

            normalized = normalize_url(str(value), page_url)
            if normalized and (
                _is_video_file(normalized)
                or is_video_context
                or declared_type.startswith("video/")
                or "mpegurl" in declared_type
            ):
                yield VideoCandidate(
                    url=normalized,
                    kind=_kind_for_url(normalized),
                    source=f"<{tag_name}> {attr}",
                )


def _extract_from_metadata(soup: BeautifulSoup, page_url: str) -> Iterable[VideoCandidate]:
    selectors = [
        ("meta", {"property": re.compile(r"^(og:video|og:video:url|og:video:secure_url)$", re.I)}),
        ("meta", {"name": re.compile(r"^(twitter:player:stream|twitter:player)$", re.I)}),
        ("link", {"rel": re.compile(r"(preload|canonical)", re.I)}),
    ]

    for name, attrs in selectors:
        for tag in soup.find_all(name, attrs=attrs):
            for attr in MEDIA_ATTRS:
                value = tag.get(attr)
                if not value:
                    continue

                normalized = normalize_url(str(value), page_url)
                if normalized and _is_video_file(normalized):
                    yield VideoCandidate(
                        url=normalized,
                        kind=_kind_for_url(normalized),
                        source=f"<{name}> {attr}",
                    )


def _extract_from_embeds(soup: BeautifulSoup, page_url: str) -> Iterable[VideoCandidate]:
    for tag in soup.find_all(list(EMBED_TAGS)):
        tag_name = tag.name or "embed"
        for attr in ("src", "data", "data-src", "data-url"):
            value = tag.get(attr)
            normalized = normalize_url(str(value), page_url) if value else None
            if not normalized:
                continue

            yield VideoCandidate(
                url=normalized,
                kind="embed" if not _is_video_file(normalized) else _kind_for_url(normalized),
                source=f"<{tag_name}> {attr}",
            )


def _extract_from_text(html_text: str, page_url: str) -> Iterable[VideoCandidate]:
    searchable = html.unescape(html_text).replace("\\/", "/")

    for regex in (ABSOLUTE_VIDEO_RE, RELATIVE_VIDEO_RE):
        for match in regex.finditer(searchable):
            normalized = normalize_url(match.group("url"), page_url)
            if normalized and _is_video_file(normalized):
                yield VideoCandidate(
                    url=normalized,
                    kind=_kind_for_url(normalized),
                    source="HTML text scan",
                )


def normalize_url(raw_value: str, page_url: str) -> str | None:
    value = html.unescape(raw_value).strip()
    value = value.replace("\\/", "/").replace("\\u002F", "/").replace("\\u002f", "/")
    value = value.strip(" \t\r\n\"'`")

    if value.startswith("url(") and value.endswith(")"):
        value = value[4:-1].strip(" \t\r\n\"'")

    value = _trim_trailing_noise(value)

    if not value:
        return None

    parsed = urlparse(value)
    if parsed.scheme in {"data", "blob", "javascript", "mailto", "tel"}:
        return None

    if value.startswith("//"):
        return f"{urlparse(page_url).scheme}:{value}"

    return urljoin(page_url, value)


def _trim_trailing_noise(value: str) -> str:
    return value.rstrip(".,;:)]}\"'")


def _is_video_file(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(f".{extension}") for extension in VIDEO_EXTENSIONS)


def _kind_for_url(url: str) -> str:
    path = urlparse(url).path.lower()
    if path.endswith(".m3u8"):
        return "hls"
    return "file"
