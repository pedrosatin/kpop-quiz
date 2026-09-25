"""Sequential MusicBrainz web service client.

MusicBrainz asks anonymous clients for at most one request per second and an
identifying User-Agent. The client enforces both and retries 503 responses,
which the service returns when a client exceeds the rate limit.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from http.client import HTTPException
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .mediawiki import parse_retry_after


API_URL = "https://musicbrainz.org/ws/2"
DEFAULT_USER_AGENT = "kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-quiz)"
MIN_INTERVAL_SECONDS = 1.1
RETRYABLE_HTTP_STATUS = frozenset({429, 500, 502, 503, 504})
ENTITY_TYPES = frozenset({"area", "artist", "event", "place", "series"})


class MusicBrainzError(RuntimeError):
    pass


class MusicBrainzClient:
    def __init__(
        self,
        api_url: str = API_URL,
        user_agent: str = DEFAULT_USER_AGENT,
        timeout: float = 30,
        retries: int = 3,
        min_interval: float = MIN_INTERVAL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        self.min_interval = min_interval
        self._clock = clock
        self._sleep = sleep
        self._last_request: float | None = None

    def lookup(self, entity: str, mbid: str, includes: tuple[str, ...] = ()) -> dict[str, Any]:
        if entity not in ENTITY_TYPES:
            raise ValueError(f"unsupported MusicBrainz entity: {entity}")
        query = {"fmt": "json"}
        if includes:
            query["inc"] = "+".join(includes)
        url = f"{self.api_url}/{entity}/{mbid}?{urlencode(query, safe='+')}"
        return self._get(url)

    def _get(self, url: str) -> dict[str, Any]:
        request = Request(url, headers={"Accept": "application/json", "User-Agent": self.user_agent})
        for attempt in range(self.retries + 1):
            can_retry = attempt < self.retries
            self._wait_for_slot()
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = json.load(response)
            except HTTPError as exc:
                headers = exc.headers
                exc.close()
                if exc.code not in RETRYABLE_HTTP_STATUS or not can_retry:
                    raise MusicBrainzError(
                        f"MusicBrainz request failed with HTTP {exc.code}: {url}"
                    ) from exc
                self._sleep(self._retry_delay(attempt, headers))
                continue
            except (URLError, TimeoutError, ConnectionError, HTTPException, json.JSONDecodeError) as exc:
                if not can_retry:
                    raise MusicBrainzError(f"MusicBrainz request failed: {url}") from exc
                self._sleep(self._retry_delay(attempt, None))
                continue
            if not isinstance(payload, dict):
                raise MusicBrainzError(f"MusicBrainz response is not a JSON object: {url}")
            return payload
        raise AssertionError("retry loop exited unexpectedly")

    def _wait_for_slot(self) -> None:
        if self._last_request is not None:
            remaining = self.min_interval - (self._clock() - self._last_request)
            if remaining > 0:
                self._sleep(remaining)
        self._last_request = self._clock()

    @staticmethod
    def _retry_delay(attempt: int, headers: Any) -> float:
        delay = float(2**attempt)
        retry_after = parse_retry_after(headers.get("Retry-After") if headers is not None else None)
        return max(delay, retry_after) if retry_after is not None else delay
