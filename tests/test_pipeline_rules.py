"""Operating rules of AGENTS.md enforced by tests instead of review.

- the reference date requires America/Sao_Paulo;
- every HTTP request goes through ``kpop_scraping.http_request.open_url``;
- importing a ``kpop_scraping`` module opens no connection and no database.
"""

from __future__ import annotations

import ast
import http.client
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request
from zoneinfo import ZoneInfoNotFoundError

from kpop_scraping import daily_puzzles_cli
from kpop_scraping.daily_puzzles_runner import get_reference_date
from kpop_scraping import http_request
from kpop_scraping.http_request import DEFAULT_USER_AGENT, ResponseRefusedError, open_url
from kpop_scraping.quiz_utils import ReferenceTimezoneError, reference_date_today


REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_DIR = REPO_ROOT / "kpop_scraping"
HTTP_HELPER = PACKAGE_DIR / "http_request.py"
# Python sources that may run in the pipeline. Tests patch the transport.
SCANNED_SOURCES = (PACKAGE_DIR, REPO_ROOT / "scripts", REPO_ROOT / "main.py")
FORBIDDEN_NAMES = frozenset({"urlopen", "build_opener", "HTTPConnection", "HTTPSConnection"})
FORBIDDEN_MODULES = frozenset({"requests", "httpx", "urllib3", "aiohttp"})

MISSING_ZONE = patch(
    "kpop_scraping.quiz_utils.ZoneInfo",
    side_effect=ZoneInfoNotFoundError("No time zone found with key America/Sao_Paulo"),
)


class ReferenceTimezoneTest(unittest.TestCase):
    def test_missing_zone_raises_instead_of_using_utc(self) -> None:
        with MISSING_ZONE, self.assertRaisesRegex(ReferenceTimezoneError, "America/Sao_Paulo"):
            reference_date_today()

    def test_runner_default_date_fails_without_zone(self) -> None:
        with MISSING_ZONE, self.assertRaises(ReferenceTimezoneError):
            get_reference_date()

    def test_explicit_date_does_not_need_the_zone(self) -> None:
        with MISSING_ZONE:
            self.assertEqual(get_reference_date("2026-11-10"), "2026-11-10")

    def test_generation_without_zone_exits_with_clear_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "kpop.db"
            database.touch()
            stderr = io.StringIO()
            with MISSING_ZONE, redirect_stdout(io.StringIO()), redirect_stderr(stderr):
                code = daily_puzzles_cli.main(
                    ["--database", str(database), "--output-dir", str(Path(tmp) / "out")]
                )
            self.assertEqual(code, 1)
            self.assertIn("America/Sao_Paulo", stderr.getvalue())
            self.assertFalse((Path(tmp) / "out").exists())


class Response:
    def __enter__(self) -> "Response":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class OpenUrlTest(unittest.TestCase):
    def test_request_carries_timeout_and_user_agent(self) -> None:
        calls = []

        def opener(request, timeout):
            calls.append((request, timeout))
            return Response()

        open_url(
            "https://example.org/a",
            timeout=12,
            user_agent=DEFAULT_USER_AGENT,
            headers={"Accept": "application/json", "User-Agent": "ignored"},
            opener=opener,
        )
        request, timeout = calls[0]
        self.assertEqual(timeout, 12)
        self.assertEqual(request.full_url, "https://example.org/a")
        self.assertEqual(request.get_header("User-agent"), DEFAULT_USER_AGENT)
        self.assertEqual(request.get_header("Accept"), "application/json")

    def test_default_transport_is_urlopen(self) -> None:
        with patch("kpop_scraping.http_request.urlopen", return_value=Response()) as urlopen:
            open_url("https://example.org/", timeout=5, user_agent="bot/1.0 (ops@example.org)")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 5)

    def test_rejects_missing_or_invalid_timeout(self) -> None:
        for timeout in (None, 0, -1, True, "30"):
            with self.subTest(timeout=timeout), self.assertRaisesRegex(ValueError, "timeout"):
                open_url("https://example.org/", timeout=timeout, user_agent=DEFAULT_USER_AGENT)

    def test_rejects_user_agent_without_contact(self) -> None:
        for user_agent in ("", "kpop-quiz/1.0", "kpop-quiz-group-signals/1.0", None):
            with self.subTest(user_agent=user_agent), self.assertRaisesRegex(ValueError, "User-Agent"):
                open_url("https://example.org/", timeout=30, user_agent=user_agent)

    def test_timeout_is_required(self) -> None:
        with self.assertRaises(TypeError):
            open_url("https://example.org/", user_agent=DEFAULT_USER_AGENT)  # type: ignore[call-arg]


class _Socket:
    """Just enough of a socket for ``http.client.HTTPResponse``."""

    def __init__(self, raw: bytes) -> None:
        self.raw = raw

    def makefile(self, _mode: str) -> io.BytesIO:
        return io.BytesIO(self.raw)


def http_response(head: str, body: bytes) -> http.client.HTTPResponse:
    response = http.client.HTTPResponse(_Socket(head.encode("ascii") + b"\r\n\r\n" + body))
    response.begin()
    return response


class ResponseLimitTest(unittest.TestCase):
    """open_url reads at most max_bytes, whatever the transport returns."""

    def fetch(self, response: object, max_bytes: int) -> object:
        return open_url(
            "https://example.org/data",
            timeout=5,
            user_agent=DEFAULT_USER_AGENT,
            opener=lambda _request, timeout: response,
            max_bytes=max_bytes,
        )

    def test_a_body_without_length_above_the_limit_is_refused(self) -> None:
        response = http_response("HTTP/1.1 200 OK\r\nConnection: close", b"x" * 11)
        with self.fetch(response, 10) as bounded:
            with self.assertRaisesRegex(ResponseRefusedError, "example.org has at least 11 bytes, above the 10-byte limit"):
                bounded.read()

    def test_a_read_without_length_asks_for_one_byte_past_the_limit(self) -> None:
        class Recording(io.BytesIO):
            """Records the size of each read, and serves whatever is asked."""

            def __init__(self, body: bytes) -> None:
                super().__init__(body)
                self.sizes: list[int | None] = []

            def read(self, size: int | None = -1) -> bytes:
                self.sizes.append(size)
                return super().read(size)

        small = Recording(b"x" * 4)
        with self.fetch(small, 10) as bounded:
            self.assertEqual(bounded.read(), b"x" * 4)
        self.assertEqual(small.sizes, [11])

        large = Recording(b"x" * 1000)
        with self.fetch(large, 10) as bounded:
            with self.assertRaisesRegex(ResponseRefusedError, "at least 11 bytes"):
                bounded.read()
        self.assertEqual(large.sizes, [11])
        self.assertTrue(large.closed)

    def test_readers_that_bypass_the_limit_are_refused(self) -> None:
        response = http_response("HTTP/1.1 200 OK\r\nConnection: close", b"line\n" * 5)
        with self.fetch(response, 10) as bounded:
            for name in ("readline", "readlines", "readinto", "read1", "peek", "fp"):
                with self.subTest(name=name), self.assertRaisesRegex(AttributeError, "use read"):
                    getattr(bounded, name)
            self.assertEqual(bounded.status, 200)
            self.assertIsNone(bounded.headers.get("Content-Length"))

    def test_a_declared_length_above_the_limit_is_refused_before_reading(self) -> None:
        response = http_response("HTTP/1.1 200 OK\r\nContent-Length: 11", b"x" * 11)
        with self.assertRaisesRegex(ResponseRefusedError, "at least 11 bytes"):
            self.fetch(response, 10)
        self.assertTrue(response.isclosed())

    def test_sized_reads_add_up_to_the_limit(self) -> None:
        with self.fetch(io.BytesIO(b"abcdefghijk"), 10) as bounded:
            self.assertEqual(bounded.read(6), b"abcdef")
            self.assertEqual(bounded.read(4), b"ghij")
            with self.assertRaises(ResponseRefusedError):
                bounded.read(1)

    def test_json_load_reads_a_body_within_the_limit(self) -> None:
        body = json.dumps({"ok": True}).encode()
        response = http_response(f"HTTP/1.1 200 OK\r\nContent-Length: {len(body)}", body)
        with self.fetch(response, len(body)) as bounded:
            self.assertEqual(json.load(bounded), {"ok": True})
            self.assertEqual(bounded.status, 200)
            self.assertEqual(bounded.headers.get("Content-Length"), str(len(body)))

    def test_a_body_cut_short_still_raises_incomplete_read(self) -> None:
        response = http_response("HTTP/1.1 200 OK\r\nContent-Length: 10", b"abc")
        with self.fetch(response, 100) as bounded:
            with self.assertRaises(http.client.IncompleteRead):
                bounded.read()

    def test_the_limit_applies_to_what_enter_returns(self) -> None:
        inner = io.BytesIO(b"x" * 11)

        class Wrapper:
            def __enter__(self) -> io.BytesIO:
                return inner

            def __exit__(self, *_exc: object) -> None:
                return None

        with self.fetch(Wrapper(), 10) as bounded:
            with self.assertRaises(ResponseRefusedError):
                bounded.read()

    def test_the_default_limit_holds_the_largest_measured_response(self) -> None:
        # 17 MB: the country-v1 entity snapshots of 2026-11-14 in one batch.
        self.assertGreaterEqual(http_request.DEFAULT_MAX_RESPONSE_BYTES, 17_072_286)
        self.assertLessEqual(http_request.DEFAULT_MAX_RESPONSE_BYTES, 256 * 1024 * 1024)

    def test_rejects_an_invalid_limit(self) -> None:
        for limit in (0, -1, True, 1.5):
            with self.subTest(limit=limit), self.assertRaisesRegex(ValueError, "max_bytes"):
                self.fetch(io.BytesIO(b""), limit)


class RedirectRuleTest(unittest.TestCase):
    def redirect(self, source: str, target: str) -> object:
        handler = http_request._NoDowngradeRedirectHandler()
        response = io.BytesIO()
        return handler.redirect_request(Request(source), response, 302, "Found", {}, target)

    def test_a_redirect_from_https_to_http_is_refused(self) -> None:
        with self.assertRaisesRegex(ResponseRefusedError, "redirect from https://example.org to a http URL"):
            self.redirect("https://example.org/a", "http://example.org/b")

    def test_a_redirect_from_https_to_ftp_is_refused(self) -> None:
        with self.assertRaises(ResponseRefusedError):
            self.redirect("https://example.org/a", "ftp://example.org/b")

    def test_redirects_that_stay_on_https_or_start_on_http_are_followed(self) -> None:
        for source, target in (
            ("https://example.org/a", "https://other.example.org/b"),
            ("http://example.org/a", "http://example.org/b"),
            ("http://example.org/a", "https://example.org/b"),
        ):
            with self.subTest(source=source, target=target):
                self.assertEqual(self.redirect(source, target).full_url, target)

    def test_the_default_transport_uses_the_rule(self) -> None:
        handlers = http_request._opener().handlers
        self.assertTrue(any(isinstance(handler, http_request._NoDowngradeRedirectHandler) for handler in handlers))
        self.assertFalse(any(type(handler).__name__ == "HTTPRedirectHandler" for handler in handlers))


def python_sources() -> list[Path]:
    files: list[Path] = []
    for source in SCANNED_SOURCES:
        files.extend(sorted(source.rglob("*.py")) if source.is_dir() else [source])
    return files


def http_violations(path: Path, source: str | None = None) -> list[str]:
    label = path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path
    tree = ast.parse(source if source is not None else path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.Name):
            names = [node.id] if node.id in FORBIDDEN_NAMES else []
        elif isinstance(node, ast.Attribute):
            names = [node.attr] if node.attr in FORBIDDEN_NAMES else []
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names = [alias.name for alias in node.names if alias.name in FORBIDDEN_NAMES]
            if module.split(".")[0] in FORBIDDEN_MODULES:
                names.append(module)
        elif isinstance(node, ast.Import):
            names = [alias.name for alias in node.names if alias.name.split(".")[0] in FORBIDDEN_MODULES]
        found.extend(f"{label}:{node.lineno}: {name}" for name in names)
    return found


class SingleHttpExitTest(unittest.TestCase):
    def test_no_http_transport_outside_helper(self) -> None:
        sources = [path for path in python_sources() if path != HTTP_HELPER]
        self.assertGreater(len(sources), 50)
        violations = [line for path in sources for line in http_violations(path)]
        self.assertEqual(violations, [], "open HTTP requests through kpop_scraping.http_request.open_url")

    def test_scan_detects_a_stray_urlopen(self) -> None:
        stray = "import urllib.request\nurllib.request.urlopen('https://example.org', timeout=1)\n"
        self.assertEqual(len(http_violations(PACKAGE_DIR / "stray.py", stray)), 1)

    def test_scan_sees_the_transport_in_the_helper(self) -> None:
        self.assertTrue(http_violations(HTTP_HELPER))


IMPORT_PROBE = r"""
import importlib
import socket
import sqlite3
import sys
import urllib.request


def refuse(*_args, **_kwargs):
    raise AssertionError("network or database access during import")


socket.socket.connect = refuse
socket.socket.connect_ex = refuse
socket.create_connection = refuse
socket.getaddrinfo = refuse
urllib.request.urlopen = refuse
sqlite3.connect = refuse

failures = []
for name in sys.argv[1:]:
    try:
        importlib.import_module(name)
    except BaseException as exc:
        failures.append(f"{name}: {type(exc).__name__}: {exc}")
print("\n".join(failures))
raise SystemExit(1 if failures else 0)
"""


def package_modules() -> list[str]:
    modules = []
    for path in sorted(PACKAGE_DIR.rglob("*.py")):
        parts = path.relative_to(REPO_ROOT).with_suffix("").parts
        if parts[-1] == "__main__":
            continue
        if parts[-1] == "__init__":
            parts = parts[:-1]
        modules.append(".".join(parts))
    return modules


class ImportWithoutSideEffectsTest(unittest.TestCase):
    def test_every_module_imports_without_network_or_sqlite(self) -> None:
        modules = package_modules()
        self.assertGreater(len(modules), 50)
        result = subprocess.run(
            [sys.executable, "-c", IMPORT_PROBE, *modules],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
