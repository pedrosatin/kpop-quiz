"""Operating rules of AGENTS.md enforced by tests instead of review.

- the reference date requires America/Sao_Paulo;
- every HTTP request goes through ``kpop_scraping.http_request.open_url``;
- importing a ``kpop_scraping`` module opens no connection and no database.
"""

from __future__ import annotations

import ast
import io
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfoNotFoundError

from kpop_scraping import daily_puzzles_cli
from kpop_scraping.daily_puzzles_runner import get_reference_date
from kpop_scraping.http_request import DEFAULT_USER_AGENT, open_url
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
