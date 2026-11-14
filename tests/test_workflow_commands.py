"""Workflow command escaping: one annotation per call, whatever the text quotes.

The runner starts a command at any line that begins with ``::``, ends the
properties at the first ``::`` and each property at ``,``. The cases below
put those characters in messages and titles, as an edited Wikipedia title,
a MusicBrainz value or the stderr of ``gh`` could.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import daily_puzzles_cli, workflow_commands
from kpop_scraping.map_pilot_refresh import DEFAULT_MAP, DEFAULT_OUTPUT, main as map_pilot_main
from kpop_scraping.workflow_commands import escape_data, escape_property, format_command
from scripts import publish_via_pr, rebuild_database

ROOT = Path(__file__).resolve().parents[1]

INJECTED_TITLE = "Alpha\n::error::injected"


def command_lines(text: str) -> list[str]:
    """The lines of a stream the runner would read as workflow commands."""
    return [line for line in text.splitlines() if line.startswith("::")]


class EscapeTests(unittest.TestCase):
    def test_data_escapes_percent_cr_and_lf(self):
        self.assertEqual(escape_data("100%\r\nnext"), "100%25%0D%0Anext")

    def test_data_escapes_percent_first(self):
        # An escape already in the text stays literal: %0A is not a line break.
        self.assertEqual(escape_data("%0A"), "%250A")

    def test_data_keeps_colons_and_commas(self):
        self.assertEqual(escape_data("a::b, c"), "a::b, c")

    def test_property_also_escapes_colon_and_comma(self):
        self.assertEqual(escape_property("a:b,c%\r\n"), "a%3Ab%2Cc%25%0D%0A")

    def test_plain_text_is_unchanged(self):
        for text in ("Daily grid not updated", "Grid kept from 2023-01-01 because generation failed: some err"):
            self.assertEqual(escape_data(text), text)
        self.assertEqual(escape_property("Daily grid not updated"), "Daily grid not updated")


class FormatCommandTests(unittest.TestCase):
    def test_message_with_a_command_on_a_new_line_stays_one_line(self):
        line = format_command("warning", INJECTED_TITLE)
        self.assertEqual(line, "::warning::Alpha%0A::error::injected")
        self.assertEqual(len(line.splitlines()), 1)

    def test_title_cannot_end_the_properties_or_open_a_command(self):
        line = format_command("warning", "body", title="Group, Alpha::error::x\r\n::notice::y")
        self.assertEqual(
            line, "::warning title=Group%2C Alpha%3A%3Aerror%3A%3Ax%0D%0A%3A%3Anotice%3A%3Ay::body"
        )
        # The first "::" after the command name is the one that ends the properties.
        self.assertEqual(line.split("::")[1], "warning title=Group%2C Alpha%3A%3Aerror%3A%3Ax%0D%0A%3A%3Anotice%3A%3Ay")

    def test_file_property_escapes_colon_and_comma(self):
        line = format_command("error", "bad", file="data/a:b,c.json", title=None)
        self.assertEqual(line, "::error file=data/a%3Ab%2Cc.json::bad")

    def test_no_title_gives_the_bare_command(self):
        self.assertEqual(format_command("notice", "done", title=None), "::notice::done")

    def test_plain_annotation_is_unchanged(self):
        self.assertEqual(
            format_command("warning", "Grid kept from 2023-01-01", title="Daily grid not updated"),
            "::warning title=Daily grid not updated::Grid kept from 2023-01-01",
        )


class WriteTests(unittest.TestCase):
    def test_each_level_writes_one_line_to_stdout(self):
        for write, name in (
            (workflow_commands.warning, "warning"),
            (workflow_commands.error, "error"),
            (workflow_commands.notice, "notice"),
        ):
            with self.subTest(name):
                stdout = io.StringIO()
                with redirect_stdout(stdout):
                    write("line one\r\nline two", title="T, one")
                self.assertEqual(stdout.getvalue(), f"::{name} title=T%2C one::line one%0D%0Aline two\n")

    def test_stream_chooses_stderr(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            workflow_commands.error("x", stream=sys.stderr)
        self.assertEqual((stdout.getvalue(), stderr.getvalue()), ("", "::error::x\n"))


class EmitterTests(unittest.TestCase):
    """Every Python emitter goes through the helper."""

    def test_daily_cli_warning_escapes_title_and_message(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), redirect_stdout(stdout), redirect_stderr(stderr):
            daily_puzzles_cli.warn("Daily grid: kept", INJECTED_TITLE)
        self.assertEqual(
            command_lines(stdout.getvalue()), ["::warning title=Daily grid%3A kept::Alpha%0A::error::injected"]
        )
        self.assertEqual(command_lines(stderr.getvalue()), [])

    def test_restore_cache_warning_escapes_the_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory, "kpop.db")
            rebuild_database.backup_path(database).write_bytes(b"cached")
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                code = rebuild_database.restore_cache(database, Path(directory, "raw"), "maxlag 100%\n::error::x")
        self.assertEqual(code, 0)
        self.assertEqual(
            command_lines(stdout.getvalue()),
            [
                "::warning title=Database not refreshed::Rebuild failed: maxlag 100%25%0A::error::x; "
                "puzzles use the cached database"
            ],
        )

    def test_rebuild_usage_error_escapes_the_environment_value(self):
        stderr = io.StringIO()
        with patch.dict(os.environ, {"REBUILD_MAX_ATTEMPTS": "1\n::error::x"}), redirect_stderr(stderr):
            code = rebuild_database.main(["rebuild", "--database", "data/kpop.db", "--", "true"])
        self.assertEqual(code, rebuild_database.EXIT_USAGE)
        self.assertEqual(len(command_lines(stderr.getvalue())), 1)
        self.assertNotIn("\n::error::x", stderr.getvalue())

    def test_publish_error_escapes_the_stderr_of_gh(self):
        failure = publish_via_pr.PublishError("gh pr merge failed with exit 1: denied\n::error::x")
        stderr = io.StringIO()
        with patch.object(publish_via_pr, "publish", side_effect=failure), redirect_stderr(stderr):
            code = publish_via_pr.main(["--repo", "o/n", "--branch", "b", "--head-sha", "a" * 40, "--title", "t"])
        self.assertEqual(code, 1)
        self.assertEqual(
            command_lines(stderr.getvalue()), ["::error::gh pr merge failed with exit 1: denied%0A::error::x"]
        )

    def test_no_python_file_writes_a_workflow_command_by_hand(self):
        literal = re.compile(r"""["']::(?:warning|error|notice)\b""")
        offenders = []
        for folder in ("kpop_scraping", "scripts"):
            for path in sorted((ROOT / folder).rglob("*.py")):
                if path.name == "workflow_commands.py":
                    continue
                for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                    if literal.search(line):
                        offenders.append(f"{path.relative_to(ROOT)}:{number}")
        self.assertEqual(offenders, [])


class MapPilotVerifyTests(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.dataset = Path(self._dir.name, "deadline-events.json")
        self.dataset.write_bytes((ROOT / DEFAULT_OUTPUT).read_bytes())

    def tearDown(self):
        self._dir.cleanup()

    def verify(self) -> tuple[int, str]:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            code = map_pilot_main(["--verify", "--output", str(self.dataset), "--map", str(ROOT / DEFAULT_MAP)])
        return code, stdout.getvalue()

    def test_committed_dataset_passes(self):
        code, output = self.verify()
        self.assertEqual(code, 0, output)
        self.assertTrue(output.startswith(f"Verified {self.dataset}: "), output)

    def test_truncated_file_fails(self):
        self.dataset.write_text(self.dataset.read_text(encoding="utf-8")[:100], encoding="utf-8")
        code, output = self.verify()
        self.assertEqual(code, 1)
        self.assertEqual(len(command_lines(output)), 1)
        self.assertTrue(output.startswith("::error title=Map pilot dataset invalid::"), output)

    def test_missing_file_fails(self):
        self.dataset.unlink()
        code, output = self.verify()
        self.assertEqual(code, 1)
        self.assertIn("FileNotFoundError", output)

    def test_event_that_fails_validation_fails_with_one_escaped_annotation(self):
        dataset = json.loads(self.dataset.read_text(encoding="utf-8"))
        # The validator quotes the MBID of the event it rejects.
        dataset["events"][0] = dict(dataset["events"][0], event_mbid="x\n::error::injected", status="draft")
        self.dataset.write_text(json.dumps(dataset), encoding="utf-8")
        code, output = self.verify()
        self.assertEqual(code, 1)
        self.assertEqual(command_lines(output), [line for line in output.splitlines() if line])
        self.assertIn("x%0A::error::injected", output)

    def test_verify_makes_no_request(self):
        with patch("kpop_scraping.map_pilot_refresh.fetch_schedule_html", side_effect=AssertionError("request")):
            code, output = self.verify()
        self.assertEqual(code, 0, output)


if __name__ == "__main__":
    unittest.main()
