"""Small MediaWiki Action API client using only the Python standard library."""

from __future__ import annotations

import json
import math
import re
import ssl
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPException
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from .http_request import DEFAULT_USER_AGENT, open_url


class MediaWikiError(RuntimeError):
    """Raised when the MediaWiki API cannot return a valid response.

    ``transient`` is true when the client gave up on a condition that passes
    with time (network, ``maxlag``, HTTP 429 and 5xx, a long ``Retry-After``).
    The CLI turns it into ``EXIT_TRANSIENT`` (``kpop_scraping/exit_codes.py``),
    the only failure the nightly rebuild repeats.
    """

    def __init__(
        self,
        message: str,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        *,
        transient: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}
        self.transient = transient


MAX_EXTRACTS_PER_REQUEST = 20
# The Action API accepts 50 revision IDs per request for regular clients.
MAX_REVISIONS_PER_REQUEST = 50
# Largest intro extract, in UTF-8 bytes, that the pipeline stores and reads as
# evidence. The evidence rules run regexes and sentence loops over the whole
# extract, so its size bounds their cost. The largest extract in the local
# database was 3.7 KB in November 2026. A page above the limit is refused and recorded
# with EXTRACT_OVERSIZE instead of reaching those rules.
MAX_EXTRACT_BYTES = 32 * 1024
EXTRACT_OVERSIZE = "page_extract_oversize"
RETRYABLE_HTTP_STATUS = frozenset({429, 500, 502, 503, 504})
MAX_RETRY_AFTER_SECONDS = 120.0
_ASCII_SECONDS = re.compile(r"[0-9]+")

# Every request sends maxlag, as Wikimedia asks of bots. When the lag is above
# it, the API answers with the "maxlag" error, a Retry-After header and the
# current lag. Wikidata counts the lag of its query service, which stayed
# between 9 and 14 seconds for hours on most nights of November 2026.
MAXLAG_SECONDS = 5
# Total time the clients of one run may wait for maxlag to clear. The nightly
# rebuild gives each run of the collector 30 minutes
# (scripts/rebuild_database.py), so the budget keeps half of that for the work
# itself, which takes about 2 minutes, and for the network backoff.
DEFAULT_MAXLAG_BUDGET_SECONDS = 15 * 60.0
MAXLAG_BUDGET_ENV = "MAXLAG_BUDGET_SECONDS"
# MediaWiki itself never sends a Retry-After below 5 seconds for maxlag.
MIN_MAXLAG_WAIT_SECONDS = 5.0


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


class MaxlagBudget:
    """Time the clients of one run may spend waiting for ``maxlag`` to clear.

    Every client built with the same budget draws from it, so all the
    requests of a run share one ceiling. The budget counts the pauses it
    grants; the network backoff of ``MediaWikiClient`` does not draw from it.
    """

    def __init__(
        self,
        seconds: float = DEFAULT_MAXLAG_BUDGET_SECONDS,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        if not math.isfinite(seconds) or seconds < 0:
            raise ValueError("the maxlag budget must be a finite number of seconds, zero or more")
        self.seconds = float(seconds)
        self.spent = 0.0
        self._sleep = sleep

    @classmethod
    def from_environment(cls, environ: Mapping[str, str]) -> MaxlagBudget:
        """Read the budget from ``MAXLAG_BUDGET_SECONDS``; empty means the default."""
        text = environ.get(MAXLAG_BUDGET_ENV, "").strip()
        if not text:
            return cls()
        try:
            seconds = float(text)
        except ValueError:
            seconds = math.nan
        if not math.isfinite(seconds) or seconds < 0:
            raise ValueError(
                f"{MAXLAG_BUDGET_ENV} must be a number of seconds, zero or more, got {text!r}"
            )
        return cls(seconds)

    @property
    def remaining(self) -> float:
        return max(0.0, self.seconds - self.spent)

    def wait(self, delay: float) -> bool:
        """Sleep for ``delay``, or what is left of it; false once nothing is left."""
        pause = min(delay, self.remaining)
        if pause <= 0:
            return False
        (self._sleep or time.sleep)(pause)
        self.spent += pause
        return True


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

    @property
    def extract_bytes(self) -> int:
        """UTF-8 size of the largest extract text this page carries.

        The snapshot keeps the extract of ``source_payload`` as the API sent
        it, and the evidence rules read that copy back, so it counts as well
        as the stripped ``extract``.
        """
        stored = (self.source_payload or {}).get("extract")
        texts = (self.extract, stored) if isinstance(stored, str) else (self.extract,)
        return max(len(text.encode("utf-8")) for text in texts)

    @property
    def is_extract_oversize(self) -> bool:
        return self.extract_bytes > MAX_EXTRACT_BYTES


class MediaWikiClient:
    def __init__(
        self,
        api_url: str = "https://en.wikipedia.org/w/api.php",
        user_agent: str = DEFAULT_USER_AGENT,
        timeout: float = 30,
        retries: int = 3,
        provider: str = "wikipedia",
        language: str = "en",
        max_retry_after: float = MAX_RETRY_AFTER_SECONDS,
        maxlag_budget: MaxlagBudget | None = None,
    ) -> None:
        self.api_url = api_url
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        self.provider = provider
        self.language = language
        self.max_retry_after = max_retry_after
        # The CLI hands one budget to every client of the run; a client built
        # alone gets a budget of its own.
        self.maxlag_budget = maxlag_budget or MaxlagBudget()

    def _get(self, parameters: dict[str, str | int]) -> dict[str, Any]:
        query = {
            "format": "json",
            "formatversion": "2",
            "maxlag": str(MAXLAG_SECONDS),
            **parameters,
        }
        url = f"{self.api_url}?{urlencode(query)}"
        # ``attempt`` counts network and HTTP failures only. A maxlag answer
        # is retried out of the run's budget and leaves it unchanged.
        attempt = 0
        while True:
            can_retry = attempt < self.retries
            try:
                with open_url(
                    url,
                    timeout=self.timeout,
                    user_agent=self.user_agent,
                    headers={"Accept": "application/json"},
                ) as response:
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
                        transient=exc.code in RETRYABLE_HTTP_STATUS,
                    ) from exc
                time.sleep(self._retry_delay(attempt, error_headers))
                attempt += 1
                continue
            except (
                URLError,
                TimeoutError,
                ConnectionError,
                HTTPException,
                # A TLS failure while json.load reads the body; urlopen
                # wraps only the ones raised while connecting in URLError.
                ssl.SSLError,
                json.JSONDecodeError,
            ) as exc:
                if not can_retry:
                    raise MediaWikiError(
                        f"MediaWiki request failed after {attempt + 1} attempts",
                        transient=True,
                    ) from exc
                time.sleep(self._retry_delay(attempt, None))
                attempt += 1
                continue
            if isinstance(payload, dict) and "error" in payload:
                error = payload["error"]
                if error.get("code") == "maxlag":
                    if self.maxlag_budget.wait(self._maxlag_delay(error, headers)):
                        continue
                    budget = self.maxlag_budget
                    raise MediaWikiError(
                        f"MediaWiki maxlag at {self.api_url} did not clear within the "
                        f"run's {budget.seconds:.0f}s wait budget ({MAXLAG_BUDGET_ENV}); "
                        f"last answer: {error.get('info', 'no details')}",
                        code="maxlag",
                        details=error,
                        transient=True,
                    )
                raise MediaWikiError(
                    f"MediaWiki error {error.get('code', 'unknown')}: "
                    f"{error.get('info', 'no details')}",
                    code=error.get("code"),
                    details=error,
                )
            if not isinstance(payload, dict):
                raise MediaWikiError("MediaWiki response is not a JSON object")
            return payload

    def _maxlag_delay(self, error: dict[str, Any], headers: Any) -> float:
        """Wait the server's Retry-After, else the reported lag, within bounds.

        A long Retry-After is cut to ``max_retry_after`` and the request is
        tried again: the run's budget, not one answer, decides when to stop.
        """
        value = headers.get("Retry-After") if headers is not None else None
        delay = parse_retry_after(value)
        if delay is None:
            lag = error.get("lag")
            valid_lag = isinstance(lag, (int, float)) and not isinstance(lag, bool)
            delay = float(lag) if valid_lag and math.isfinite(lag) else MIN_MAXLAG_WAIT_SECONDS
        return min(self.max_retry_after, max(MIN_MAXLAG_WAIT_SECONDS, delay))

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
                f"{self.max_retry_after:.0f}s limit",
                transient=True,
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
        clean = self._clean_titles(titles)
        if not clean:
            return []
        payload = self._title_query(clean)
        redirects = {
            item.get("to")
            for item in payload.get("query", {}).get("redirects", ())
            if isinstance(item, dict)
        }
        try:
            return [
                self._title_page(item, item["title"] in redirects)
                for item in payload["query"]["pages"]
            ]
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise MediaWikiError("MediaWiki title response has an unexpected shape") from exc

    def resolve_titles(self, titles: Sequence[str]) -> dict[str, Page]:
        """Map each requested title to the page it resolves to.

        ``is_redirect`` is true only for a title that reached its page through
        a redirect, so two titles that land on the same page are told apart.
        A title with no page comes back with ``is_missing`` set.
        """
        clean = self._clean_titles(titles)
        if not clean:
            return {}
        payload = self._title_query(clean)
        query = payload.get("query", {})
        try:
            normalized = {item["from"]: item["to"] for item in query.get("normalized", ())}
            redirected = {item["from"]: item["to"] for item in query.get("redirects", ())}
            by_title = {item["title"]: item for item in query["pages"]}
            result: dict[str, Page] = {}
            for requested in clean:
                title = normalized.get(requested, requested)
                resolved, hops = title, 0
                while resolved in redirected and hops <= len(redirected):
                    resolved, hops = redirected[resolved], hops + 1
                if resolved in by_title:
                    result[requested] = self._title_page(by_title[resolved], hops > 0)
            return result
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise MediaWikiError("MediaWiki title response has an unexpected shape") from exc

    @staticmethod
    def _clean_titles(titles: Sequence[str]) -> tuple[str, ...]:
        clean = tuple(dict.fromkeys(title.strip() for title in titles if title.strip()))
        if len(clean) > MAX_EXTRACTS_PER_REQUEST:
            raise ValueError(
                f"title queries accept at most {MAX_EXTRACTS_PER_REQUEST} titles"
            )
        return clean

    def _title_query(self, titles: Sequence[str]) -> dict[str, Any]:
        return self._get({
            "action": "query",
            "titles": "|".join(titles),
            "redirects": "1",
            "prop": "extracts|info|pageprops|revisions",
            "exintro": "1",
            "exlimit": len(titles),
            "explaintext": "1",
            "inprop": "url",
            "ppprop": "wikibase_item|disambiguation",
            "rvprop": "ids",
        })

    @staticmethod
    def _title_page(item: dict[str, Any], is_redirect: bool) -> Page:
        revisions = item.get("revisions", [])
        pageprops = item.get("pageprops", {})
        return Page(
            page_id=int(item.get("pageid", -1)),
            title=item["title"],
            canonical_url=item.get("canonicalurl", ""),
            extract=item.get("extract", "").strip(),
            revision_id=revisions[0]["revid"] if revisions else None,
            source_payload={key: value for key, value in item.items() if key != "pageprops"},
            wikidata_id=pageprops.get("wikibase_item"),
            is_redirect=is_redirect,
            is_disambiguation="disambiguation" in pageprops,
            is_missing=bool(item.get("missing", False)),
        )

    def get_revision_wikitext(self, revision_ids: Sequence[int]) -> dict[int, dict[str, Any]]:
        """Return the main-slot wikitext of fixed revisions, keyed by revid.

        Revisions whose content is hidden or deleted are left out, so the
        caller can tell them apart from revisions with empty text.
        """
        if not revision_ids:
            return {}
        if len(revision_ids) > MAX_REVISIONS_PER_REQUEST:
            raise ValueError(
                f"get_revision_wikitext accepts at most {MAX_REVISIONS_PER_REQUEST} revision IDs"
            )
        payload = self._get({
            "action": "query",
            "revids": "|".join(str(revision_id) for revision_id in revision_ids),
            "prop": "revisions",
            "rvprop": "ids|content",
            "rvslots": "main",
        })
        result: dict[int, dict[str, Any]] = {}
        try:
            for page in payload.get("query", {}).get("pages", ()):
                for revision in page.get("revisions", ()):
                    main = revision["slots"]["main"]
                    content = main.get("content")
                    if not isinstance(content, str) or main.get("texthidden"):
                        continue
                    result[int(revision["revid"])] = {
                        "pageid": int(page["pageid"]),
                        "revid": int(revision["revid"]),
                        "contentmodel": main.get("contentmodel", ""),
                        "wikitext": content,
                    }
        except (KeyError, TypeError, ValueError) as exc:
            raise MediaWikiError("MediaWiki revision response has an unexpected shape") from exc
        return result
