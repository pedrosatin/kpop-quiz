"""The publish jobs commit only the files their verifiers know (ADR 040)."""

from __future__ import annotations

import io
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from kpop_scraping.publish_file_set import MAX_LISTED, main, refused_entries

ROOT = Path(__file__).resolve().parents[1]
PUBLISHED = ROOT / "web" / "public" / "data"
MAP_PILOT = ROOT / "data" / "map-pilot"


def run(*argv: str) -> tuple[int, str]:
    stdout = io.StringIO()
    with redirect_stdout(stdout):
        code = main(list(argv))
    return code, stdout.getvalue()


class PublishedSetTests(unittest.TestCase):
    """``--suffix .json`` on a copy of the published daily set."""

    @classmethod
    def setUpClass(cls):
        cls._temp = tempfile.TemporaryDirectory()
        cls.source = Path(cls._temp.name, "source")
        shutil.copytree(PUBLISHED, cls.source)

    @classmethod
    def tearDownClass(cls):
        cls._temp.cleanup()

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.data = Path(self._dir.name, "data")
        shutil.copytree(self.source, self.data)

    def tearDown(self):
        self._dir.cleanup()

    def check(self) -> tuple[int, str]:
        return run(str(self.data), "--suffix", ".json")

    def test_published_set_passes(self):
        code, output = self.check()
        self.assertEqual(code, 0, output)
        self.assertEqual(output, f"Checked {self.data}: every file matches *.json\n")

    def test_extra_json_file_is_accepted_by_the_suffix_rule(self):
        # An extra JSON file passes both checks; web_publish reads only the files of the set (ADR 040).
        (self.data / "zz-extra.json").write_text("{}", encoding="utf-8")
        self.assertEqual(self.check()[0], 0)

    def test_file_that_is_not_json_fails_at_any_depth(self):
        for relative in ("zz-extra.txt", "next/run.sh", "next/run.json.sh", ".hidden", "next/sub/page.html"):
            with self.subTest(relative):
                path = self.data / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("x", encoding="utf-8")
                code, output = self.check()
                self.assertEqual(code, 1)
                self.assertTrue(output.startswith("::error title=Unexpected files in the artifact::"), output)
                self.assertIn(relative, output)
                path.unlink()

    def test_symbolic_links_fail_even_with_a_json_name(self):
        (self.data / "link.json").symlink_to(self.data / "manifest-v2.json")
        (self.data / "dir.json").symlink_to(self.data / "next", target_is_directory=True)
        self.assertEqual(refused_entries(self.data, suffix=".json"), ["dir.json", "link.json"])
        self.assertEqual(self.check()[0], 1)

    def test_hostile_file_name_stays_in_one_annotation(self):
        (self.data / "a\n::error::b").write_text("x", encoding="utf-8")
        code, output = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(len(output.splitlines()), 1, output)
        self.assertIn("a%0A::error::b", output)

    def test_long_list_is_cut(self):
        for number in range(MAX_LISTED + 3):
            (self.data / f"extra-{number:02d}.txt").write_text("x", encoding="utf-8")
        code, output = self.check()
        self.assertEqual(code, 1)
        self.assertIn(f"holds {MAX_LISTED + 3} file(s)", output)
        self.assertIn(" and 3 more", output)


class MapPilotSetTests(unittest.TestCase):
    """``--only deadline-events.json`` on a copy of ``data/map-pilot``."""

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.data = Path(self._dir.name, "map-pilot")
        shutil.copytree(MAP_PILOT, self.data)

    def tearDown(self):
        self._dir.cleanup()

    def check(self) -> tuple[int, str]:
        return run(str(self.data), "--only", "deadline-events.json")

    def test_committed_directory_passes(self):
        self.assertEqual(sorted(os.listdir(self.data)), ["deadline-events.json"])
        code, output = self.check()
        self.assertEqual(code, 0, output)

    def test_any_other_file_fails_json_included(self):
        for relative in ("other-events.json", "notes.txt", "sub/deadline-events.json"):
            with self.subTest(relative):
                path = self.data / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")
                code, output = self.check()
                self.assertEqual(code, 1)
                self.assertIn(relative, output)
                path.unlink()

    def test_listed_file_as_a_link_fails(self):
        target = Path(self._dir.name, "outside.json")
        (self.data / "deadline-events.json").replace(target)
        (self.data / "deadline-events.json").symlink_to(target)
        self.assertEqual(self.check()[0], 1)

    def test_missing_directory_fails(self):
        shutil.rmtree(self.data)
        code, output = self.check()
        self.assertEqual(code, 1)
        self.assertIn("is not a directory", output)


class RuleTests(unittest.TestCase):
    def test_exactly_one_rule(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                refused_entries(Path(directory))
            with self.assertRaises(ValueError):
                refused_entries(Path(directory), suffix=".json", only=["a.json"])


if __name__ == "__main__":
    unittest.main()
