"""Single outbound HTTP entry point of the pipeline.

Every client opens its requests through :func:`open_url`, which refuses a
request without a positive timeout or without a ``User-Agent`` that names a
contact (a URL or an e-mail address). Retries, rate limits and ``maxlag``
stay in each client. ``tests/test_pipeline_rules.py`` fails when ``urlopen``
appears anywhere else.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any
from urllib.request import Request, urlopen


DEFAULT_USER_AGENT = "kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-quiz)"
_CONTACT = re.compile(r"https?://\S+|[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+")


def open_url(
    url: str,
    *,
    timeout: float,
    user_agent: str,
    headers: Mapping[str, str] | None = None,
    opener: Callable[..., Any] | None = None,
) -> Any:
    """Open ``url`` with a mandatory timeout and an identifiable User-Agent.

    ``opener`` replaces ``urlopen`` for clients that inject a transport.
    The caller closes the returned response, usually with ``with``.
    """
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not timeout > 0:
        raise ValueError(f"HTTP timeout must be a positive number of seconds, got {timeout!r}")
    if not isinstance(user_agent, str) or _CONTACT.search(user_agent) is None:
        raise ValueError(
            "HTTP User-Agent must identify the client with a contact URL or e-mail, "
            f"got {user_agent!r}"
        )
    request = Request(url, headers={**(headers or {}), "User-Agent": user_agent})
    return (opener or urlopen)(request, timeout=timeout)
