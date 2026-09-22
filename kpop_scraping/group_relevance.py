"""Collect reproducible group relevance measurements from Wikimedia Pageviews."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import date, timedelta
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .storage import Repository, canonical_json


PAGEVIEWS_API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"
WINDOW_DAYS = 365
RETRIES = 3
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class PageviewError(RuntimeError):
    """The Wikimedia Pageviews API did not yield a valid measurement."""


@dataclass(frozen=True)
class PageviewMeasurement:
    title: str
    start_date: str
    end_date: str
    total_views: int
    days_observed: int
    source_url: str
    response_json: str
    response_sha256: str


def pageview_window(reference_date: date, days: int = WINDOW_DAYS) -> tuple[str, str]:
    """Return the inclusive window of completed UTC days before reference_date.

    The UTC day before reference_date is often still unpublished, so the
    window ends two days earlier.
    """
    if days < 1:
        raise ValueError("days must be positive")
    end = reference_date - timedelta(days=2)
    start = end - timedelta(days=days - 1)
    return start.isoformat(), end.isoformat()


def _article_key(title: str) -> str:
    return title.strip().replace(" ", "_")


def _retry_delay(attempt: int, status: int, retry_after: str | None) -> float:
    """Return the wait before another try. A 429 honors Retry-After, capped at 120s."""
    delay = float(2**attempt)
    if status == 429 and retry_after and retry_after.strip().isdigit():
        delay = max(delay, min(float(int(retry_after.strip())), 120.0))
    return delay


def _expected_timestamps(start_date: str, end_date: str) -> list[str]:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if end < start:
        raise PageviewError("Pageviews window ends before it starts")
    stamps: list[str] = []
    current = start
    while current <= end:
        stamps.append(current.strftime("%Y%m%d") + "00")
        current += timedelta(days=1)
    return stamps


class PageviewClient:
    def __init__(
        self,
        user_agent: str,
        timeout: float = 30,
        retries: int = RETRIES,
    ) -> None:
        if not user_agent.strip():
            raise ValueError("user_agent must not be empty")
        if timeout <= 0 or retries < 0:
            raise ValueError("timeout must be positive and retries cannot be negative")
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries

    def fetch(self, title: str, start_date: str, end_date: str) -> PageviewMeasurement:
        clean_title = title.strip()
        if not clean_title:
            raise ValueError("page title must not be empty")
        start = start_date.replace("-", "")
        end = end_date.replace("-", "")
        if len(start) != 8 or len(end) != 8:
            raise ValueError("dates must use YYYY-MM-DD")
        url = (
            f"{PAGEVIEWS_API}/en.wikipedia/all-access/user/"
            f"{quote(clean_title.replace(' ', '_'), safe='')}/daily/{start}/{end}"
        )
        request = Request(url, headers={"Accept": "application/json", "User-Agent": self.user_agent})
        for attempt in range(self.retries + 1):
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = json.load(response)
            except HTTPError as exc:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                status = exc.code
                exc.close()
                if status not in RETRYABLE_STATUS or attempt == self.retries:
                    raise PageviewError(f"Pageviews request failed with HTTP {status}") from exc
                time.sleep(_retry_delay(attempt, status, retry_after))
            except (URLError, TimeoutError, ConnectionError, HTTPException, json.JSONDecodeError) as exc:
                if attempt == self.retries:
                    raise PageviewError("Pageviews request failed after retries") from exc
                time.sleep(_retry_delay(attempt, 0, None))
            else:
                return self._measurement(clean_title, start_date, end_date, url, payload)
        raise AssertionError("retry loop exited unexpectedly")

    @staticmethod
    def _measurement(
        title: str, start_date: str, end_date: str, source_url: str, payload: object
    ) -> PageviewMeasurement:
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise PageviewError("Pageviews response has an unexpected shape")
        items = payload["items"]
        if not items:
            raise PageviewError("Pageviews response contains no days")
        expected = _expected_timestamps(start_date, end_date)
        expected_set = set(expected)
        views: list[int] = []
        seen: list[str] = []
        for item in items:
            if not isinstance(item, dict) or type(item.get("views")) is not int or item["views"] < 0:
                raise PageviewError("Pageviews response contains an invalid view count")
            if _article_key(str(item.get("article", ""))) != _article_key(title):
                raise PageviewError("Pageviews response is for a different article")
            if (
                item.get("project") != "en.wikipedia"
                or item.get("access") != "all-access"
                or item.get("agent") != "user"
                or item.get("granularity") != "daily"
            ):
                raise PageviewError("Pageviews response does not match the requested series")
            timestamp = item.get("timestamp")
            if not isinstance(timestamp, str) or timestamp not in expected_set:
                raise PageviewError("Pageviews response contains a day outside the window")
            views.append(item["views"])
            seen.append(timestamp)
        if len(seen) != len(set(seen)):
            raise PageviewError("Pageviews response repeats a day")
        observed = set(seen)
        if expected[-1] not in observed:
            raise PageviewError("Pageviews response does not include the last requested day")
        # A new article has no rows before it exists. Those days count as zero.
        # A hole, or a missing final day, would undercount a page that did exist.
        if observed != set(expected[expected.index(min(seen)):]):
            raise PageviewError("Pageviews response has a gap inside the window")
        response = canonical_json(payload)
        return PageviewMeasurement(
            title, start_date, end_date, sum(views), len(views), source_url,
            response.decode("utf-8"), hashlib.sha256(response).hexdigest(),
        )


def collect_group_pageviews(
    repository: Repository,
    client: PageviewClient,
    reference_date: date,
    days: int = WINDOW_DAYS,
    group_limit: int | None = None,
    pause_seconds: float = 1.0,
) -> int:
    """Persist one measurement per accepted group. Only a completed run is used."""
    if pause_seconds < 0:
        raise ValueError("pause_seconds cannot be negative")
    start_date, end_date = pageview_window(reference_date, days)
    groups = repository.accepted_group_pages()
    if group_limit is not None:
        if group_limit < 1:
            raise ValueError("group_limit must be positive")
        groups = groups[:group_limit]
    run_id = repository.start_group_pageview_run(start_date, end_date, len(groups))
    collected = 0
    try:
        for index, group in enumerate(groups):
            if index and pause_seconds:
                time.sleep(pause_seconds)
            measurement = client.fetch(group["page_title"], start_date, end_date)
            repository.save_group_pageviews(
                run_id, int(group["entity_id"]), measurement.title,
                measurement.start_date, measurement.end_date, measurement.total_views,
                measurement.days_observed, measurement.source_url,
                measurement.response_json, measurement.response_sha256,
            )
            collected += 1
        repository.complete_group_pageview_run(run_id, collected)
        return collected
    except Exception as exc:
        repository.fail_group_pageview_run(run_id, str(exc))
        raise
