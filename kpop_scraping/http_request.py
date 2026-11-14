"""Single outbound HTTP entry point of the pipeline.

Every client opens its requests through :func:`open_url`, which refuses a
request without a positive timeout or without a ``User-Agent`` that names a
contact (a URL or an e-mail address). Retries, rate limits and ``maxlag``
stay in each client. ``tests/test_pipeline_rules.py`` fails when ``urlopen``
appears anywhere else.

Two limits apply to every response. A body may hold at most ``max_bytes``
bytes, ``DEFAULT_MAX_RESPONSE_BYTES`` unless the caller passes another
value, and a request made over https never follows a redirect to another
scheme. Both raise :class:`ResponseRefusedError`.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from functools import cache
from typing import Any
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, OpenerDirector, Request, build_opener


DEFAULT_USER_AGENT = "kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-quiz)"
_CONTACT = re.compile(r"https?://\S+|[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+")

# The largest body the pipeline has received is a Wikidata ``wbgetentities``
# batch of country entities: the 24 country-v1 snapshots in data/raw add up
# to 17 MB of JSON on 2026-11-14, Q30 alone to 1.6 MB, and one batch may ask
# for 50 entities. The largest Wikipedia revision wikitext is 288 KB. The
# limit leaves room for larger batches and still stops a body that would not
# fit in the runner's memory once parsed.
DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024


class ResponseRefusedError(RuntimeError):
    """A response broke a limit of :func:`open_url`: its size or its redirect."""


class _NoDowngradeRedirectHandler(HTTPRedirectHandler):
    """Follow redirects, except one that leaves https.

    urllib copies the request headers to the redirected request, so a
    downgrade would send them, and the API key header of a client, in clear
    text.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        target = urlsplit(newurl).scheme
        if urlsplit(req.full_url).scheme == "https" and target != "https":
            fp.close()
            raise ResponseRefusedError(
                f"refused HTTP {code} redirect from https://{urlsplit(req.full_url).netloc} "
                f"to a {target} URL"
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@cache
def _opener() -> OpenerDirector:
    # Built on the first request, never on import.
    return build_opener(_NoDowngradeRedirectHandler)


def urlopen(request: Request, *, timeout: float) -> Any:
    """Default transport: urllib's handlers with the redirect rule above."""
    return _opener().open(request, timeout=timeout)


class _BoundedResponse:
    """Delegate to a response and refuse to read more than ``limit`` bytes.

    A ``read()`` without a size asks the response for everything when
    http.client knows the body length, which is then within the limit, so a
    body cut short still raises ``IncompleteRead`` as before. Without a known
    length it asks for one byte more than the limit allows.

    ``read`` is the only way to the body. The other readers of the response
    and its underlying file (``_UNBOUNDED``) raise ``AttributeError``, since
    they would bypass the count. Every other attribute, such as ``headers``
    and ``status``, comes from the response.
    """

    _UNBOUNDED = frozenset({"readline", "readlines", "readinto", "readinto1", "read1", "peek", "fp", "file"})

    def __init__(self, response: Any, limit: int, host: str) -> None:
        self._response = response
        self._limit = limit
        self._host = host
        self._consumed = 0
        length = getattr(response, "length", None)
        self._length = length if isinstance(length, int) and not isinstance(length, bool) else None
        if self._length is not None and self._length > limit:
            self._refuse(self._length)

    def _refuse(self, size: int) -> None:
        close = getattr(self._response, "close", None)
        if callable(close):
            close()
        raise ResponseRefusedError(
            f"response from {self._host} has at least {size} bytes, above the {self._limit}-byte limit"
        )

    def read(self, size: int | None = -1) -> bytes:
        remaining = self._limit - self._consumed
        if size is None or size < 0:
            data = self._response.read() if self._length is not None else self._response.read(remaining + 1)
        else:
            data = self._response.read(min(size, remaining + 1))
        self._consumed += len(data)
        if self._consumed > self._limit:
            self._refuse(self._consumed)
        return data

    def __enter__(self) -> _BoundedResponse:
        entered = self._response.__enter__()
        if entered is self._response:
            return self
        return _BoundedResponse(entered, self._limit, self._host)

    def __exit__(self, *exc_info: object) -> Any:
        return self._response.__exit__(*exc_info)

    def __getattr__(self, name: str) -> Any:
        if name in self._UNBOUNDED:
            raise AttributeError(f"{name} would read past the response limit; use read()")
        return getattr(self._response, name)


def open_url(
    url: str,
    *,
    timeout: float,
    user_agent: str,
    headers: Mapping[str, str] | None = None,
    opener: Callable[..., Any] | None = None,
    max_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
) -> Any:
    """Open ``url`` with a mandatory timeout and an identifiable User-Agent.

    ``opener`` replaces the default transport for clients that inject one;
    the size limit still applies to what it returns, and the redirect rule
    is then up to it. The caller closes the returned response, usually with
    ``with``.
    """
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not timeout > 0:
        raise ValueError(f"HTTP timeout must be a positive number of seconds, got {timeout!r}")
    if not isinstance(user_agent, str) or _CONTACT.search(user_agent) is None:
        raise ValueError(
            "HTTP User-Agent must identify the client with a contact URL or e-mail, "
            f"got {user_agent!r}"
        )
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 1:
        raise ValueError(f"max_bytes must be a positive integer, got {max_bytes!r}")
    request = Request(url, headers={**(headers or {}), "User-Agent": user_agent})
    response = (opener or urlopen)(request, timeout=timeout)
    return _BoundedResponse(response, max_bytes, urlsplit(url).netloc)
