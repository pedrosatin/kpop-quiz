"""Small MediaWiki Action API client using only the Python standard library."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPException
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class MediaWikiError(RuntimeError):
    """Raised when the MediaWiki API cannot return a valid response."""

    def __init__(
        self,
        message: str,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


MAX_EXTRACTS_PER_REQUEST = 20
RETRYABLE_HTTP_STATUS = frozenset({429, 500, 502, 503, 504})
MAX_RETRY_AFTER_SECONDS = 120.0
_ASCII_SECONDS = re.compile(r"[0-9]+")


def parse_retry_after(value: str | None, now: datetime | None = None) -> float | None:
    """Parse Retry-After as seconds or HTTP date; invalid values are ignored."""
    if value is None:
        return None
    text = value.strip()
    if _ASCII_SECONDS.fullmatch(text):
        return float(text)
    try:
        moment = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    return max(0.0, (moment - current).total_seconds())


@dataclass(frozen=True)
class Page:
    page_id: int
    title: str
    canonical_url: str
    extract: str
    revision_id: int | None
    source_payload: dict[str, Any] | None = field(default=None, compare=False, repr=False)
    wikidata_id: str | None = None
    is_redirect: bool = False
    is_disambiguation: bool = False
    is_missing: bool = False


class MediaWikiClient:
    def __init__(
        self,
        api_url: str = "https://en.wikipedia.org/w/api.php",
        user_agent: str = "kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-scraping)",
        timeout: float = 30,
        retries: int = 3,
        provider: str = "wikipedia",
        language: str = "en",
        max_retry_after: float = MAX_RETRY_AFTER_SECONDS,
    ) -> None:
        self.api_url = api_url
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        self.provider = provider
        self.language = language
        self.max_retry_after = max_retry_after

    def _get(self, parameters: dict[str, str | int]) -> dict[str, Any]:
        query = {"format": "json", "formatversion": "2", "maxlag": "5", **parameters}
        request = Request(
            f"{self.api_url}?{urlencode(query)}",
            headers={"Accept": "application/json", "User-Agent": self.user_agent},
        )
        for attempt in range(self.retries + 1):
            can_retry = attempt < self.retries
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    headers = getattr(response, "headers", None)
                    payload = json.load(response)
            except HTTPError as exc:
                error_headers = exc.headers
                exc.close()
                if exc.code not in RETRYABLE_HTTP_STATUS or not can_retry:
                    raise MediaWikiError(
                        f"MediaWiki request failed with HTTP {exc.code} "
                        f"after {attempt + 1} attempts",
                        code=f"http_{exc.code}",
                    ) from exc
                time.sleep(self._retry_delay(attempt, error_headers))
                continue
            except (
                URLError,
                TimeoutError,
                ConnectionError,
                HTTPException,
                json.JSONDecodeError,
            ) as exc:
                if not can_retry:
                    raise MediaWikiError(
                        f"MediaWiki request failed after {attempt + 1} attempts"
                    ) from exc
                time.sleep(self._retry_delay(attempt, None))
                continue
            if isinstance(payload, dict) and "error" in payload:
                error = payload["error"]
                if error.get("code") == "maxlag" and can_retry:
                    time.sleep(self._retry_delay(attempt, headers))
                    continue
                raise MediaWikiError(
                    f"MediaWiki error {error.get('code', 'unknown')}: "
                    f"{error.get('info', 'no details')}",
                    code=error.get("code"),
                    details=error,
                )
            if not isinstance(payload, dict):
                raise MediaWikiError("MediaWiki response is not a JSON object")
            return payload
        raise AssertionError("retry loop exited unexpectedly")

    def _retry_delay(self, attempt: int, headers: Any) -> float:
        """Return exponential backoff, extended by a valid Retry-After header."""
        delay = float(2**attempt)
        value = headers.get("Retry-After") if headers is not None else None
        retry_after = parse_retry_after(value)
        if retry_after is None:
            return delay
        if retry_after > self.max_retry_after:
            raise MediaWikiError(
                f"server asked to wait {retry_after:.0f}s, above the "
                f"{self.max_retry_after:.0f}s limit"
            )
        return max(delay, retry_after)

    def iter_category_members(self, category: str) -> Iterator[dict[str, Any]]:
        continuation: dict[str, str] = {}
        while True:
            payload = self._get({
                "action": "query",
                "list": "categorymembers",
                "cmtitle": category,
                "cmnamespace": "0",
                "cmtype": "page",
                "cmlimit": "max",
                **continuation,
            })
            try:
                members = payload["query"]["categorymembers"]
            except (KeyError, TypeError) as exc:
                raise MediaWikiError("MediaWiki category response has an unexpected shape") from exc
            yield from members
            if "continue" not in payload:
                return
            continuation = payload["continue"]

    def get_pages(self, page_ids: Sequence[int]) -> list[Page]:
        if not page_ids:
            return []
        if len(page_ids) > MAX_EXTRACTS_PER_REQUEST:
            raise ValueError(
                f"get_pages accepts at most {MAX_EXTRACTS_PER_REQUEST} page IDs"
            )
        payload = self._get({
            "action": "query",
            "pageids": "|".join(str(page_id) for page_id in page_ids),
            "prop": "extracts|info|pageprops|revisions",
            "exintro": "1",
            "exlimit": len(page_ids),
            "explaintext": "1",
            "inprop": "url",
            "ppprop": "wikibase_item|disambiguation",
            "rvprop": "ids",
        })
        pages = []
        try:
            response_pages = payload["query"]["pages"]
            for item in response_pages:
                revisions = item.get("revisions", [])
                pageprops = item.get("pageprops", {})
                is_missing = bool(item.get("missing", False))
                pages.append(Page(
                    page_id=item["pageid"],
                    title=item["title"],
                    canonical_url=item.get("canonicalurl", ""),
                    extract=item.get("extract", "").strip(),
                    revision_id=revisions[0]["revid"] if revisions else None,
                    # Page properties are stored as observed catalog metadata.
                    # Keeping them out of the revision snapshot preserves the
                    # Phase 1 snapshot contract when the query shape expands.
                    source_payload={
                        key: value for key, value in item.items() if key != "pageprops"
                    },
                    wikidata_id=pageprops.get("wikibase_item"),
                    is_redirect=bool(item.get("redirect", False)),
                    is_disambiguation="disambiguation" in pageprops,
                    is_missing=is_missing,
                ))
        except (KeyError, TypeError, IndexError) as exc:
            raise MediaWikiError("MediaWiki page response has an unexpected shape") from exc
        return pages

    def get_pages_by_titles(self, titles: Sequence[str]) -> list[Page]:
        """Resolve titles and return the current fixed revisions and intro text."""
        clean = tuple(dict.fromkeys(title.strip() for title in titles if title.strip()))
        if not clean:
            return []
        if len(clean) > MAX_EXTRACTS_PER_REQUEST:
            raise ValueError(
                f"get_pages_by_titles accepts at most {MAX_EXTRACTS_PER_REQUEST} titles"
            )
        payload = self._get({
            "action": "query",
            "titles": "|".join(clean),
            "redirects": "1",
            "prop": "extracts|info|pageprops|revisions",
            "exintro": "1",
            "exlimit": len(clean),
            "explaintext": "1",
            "inprop": "url",
            "ppprop": "wikibase_item|disambiguation",
            "rvprop": "ids",
        })
        redirects = {
            item.get("to")
            for item in payload.get("query", {}).get("redirects", ())
            if isinstance(item, dict)
        }
        try:
            response_pages = payload["query"]["pages"]
            pages = []
            for item in response_pages:
                revisions = item.get("revisions", [])
                pageprops = item.get("pageprops", {})
                missing = bool(item.get("missing", False))
                pages.append(Page(
                    page_id=int(item.get("pageid", -1)),
                    title=item["title"],
                    canonical_url=item.get("canonicalurl", ""),
                    extract=item.get("extract", "").strip(),
                    revision_id=revisions[0]["revid"] if revisions else None,
                    source_payload={key: value for key, value in item.items() if key != "pageprops"},
                    wikidata_id=pageprops.get("wikibase_item"),
                    is_redirect=item["title"] in redirects,
                    is_disambiguation="disambiguation" in pageprops,
                    is_missing=missing,
                ))
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise MediaWikiError("MediaWiki title response has an unexpected shape") from exc
        return pages
