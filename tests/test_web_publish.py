import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import web_publish
from kpop_scraping.web_publish import build_manifest, main, publish, verify
from kpop_scraping.quiz_schema import validate_session


FIXTURES = Path(__file__).parents[1] / "web" / "public" / "data"


class WebPublishTests(unittest.TestCase):
    def sessions(self):
        manifest = json.loads((FIXTURES / "manifest-v2.json").read_text())
        return {
            key: json.loads((FIXTURES / item["path"]).read_text())
            for key, item in manifest["sessions"].items()
        }

    def test_publishes_and_verifies_canonical_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            verify(output)
            self.assertEqual((output / "manifest-v2.json").read_bytes()[-1:], b"\n")
            manifest = json.loads((output / "manifest-v2.json").read_text())
            for locale, item in manifest["sessions"].items():
                self.assertEqual(item["path"], f"session.{locale}.{item['sha256']}.json")
                self.assertTrue((output / item["path"]).is_file())

    def test_new_publication_keeps_files_referenced_by_previous_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            sessions = self.sessions()
            publish(output, sessions)
            previous = json.loads((output / "manifest-v2.json").read_text())
            previous_files = {
                locale: (output / item["path"]).read_bytes()
                for locale, item in previous["sessions"].items()
            }
            sessions["en.standard"]["config"]["seed"] = "next-release"
            sessions["en.standard"]["session_id"] = "0" * 64
            publish(output, sessions)
            for locale, content in previous_files.items():
                self.assertEqual((output / previous["sessions"][locale]["path"]).read_bytes(), content)

    def test_interrupted_publication_leaves_previous_manifest_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            sessions = self.sessions()
            publish(output, sessions)
            previous_manifest = (output / "manifest-v2.json").read_bytes()
            sessions["pt-BR.standard"]["config"]["seed"] = "next-release"
            original_write = web_publish.write_json_atomic
            writes = 0

            def fail_during_session_writes(*args, **kwargs):
                nonlocal writes
                writes += 1
                if writes == 2:
                    raise OSError("simulated write failure")
                return original_write(*args, **kwargs)

            with patch("kpop_scraping.web_publish.write_json_atomic", side_effect=fail_during_session_writes):
                with self.assertRaisesRegex(OSError, "simulated"):
                    publish(output, sessions)
            self.assertEqual((output / "manifest-v2.json").read_bytes(), previous_manifest)
            verify(output)

    def test_rejects_locale_mismatch(self):
        sessions = self.sessions()
        sessions["en.standard"] = sessions["pt-BR.standard"]
        with self.assertRaisesRegex(ValueError, "language"):
            build_manifest(sessions)

    def test_rejects_dataset_version_mismatch(self):
        sessions = self.sessions()
        sessions["en.standard"]["dataset_version"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "one dataset"):
            build_manifest(sessions)

    def test_verify_detects_changed_session(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            manifest = json.loads((output / "manifest-v2.json").read_text())
            session_path = output / manifest["sessions"]["en.standard"]["path"]
            payload = json.loads(session_path.read_text())
            payload["config"]["seed"] = "changed"
            session_path.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "manifest"):
                verify(output)

    def test_invalid_input_does_not_replace_existing_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            before = {path.name: path.read_bytes() for path in output.iterdir()}
            sessions = self.sessions()
            sessions["en.standard"]["questions"] = []
            with self.assertRaises(ValueError):
                publish(output, sessions)
            self.assertEqual(
                before,
                {path.name: path.read_bytes() for path in output.iterdir()},
            )

    def test_verify_rejects_missing_or_swapped_session(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            manifest = json.loads((output / "manifest-v2.json").read_text())
            (output / manifest["sessions"]["en.standard"]["path"]).unlink()
            with self.assertRaisesRegex(ValueError, "cannot read session"):
                verify(output)
            publish(output, self.sessions())
            manifest = json.loads((output / "manifest-v2.json").read_text())
            en_path = output / manifest["sessions"]["en.standard"]["path"]
            pt_path = output / manifest["sessions"]["pt-BR.standard"]["path"]
            en_path.write_bytes(pt_path.read_bytes())
            with self.assertRaisesRegex(ValueError, "language"):
                verify(output)

    def test_cli_requires_a_complete_source(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(main(["--output-dir", directory]), 1)

    def test_checked_in_fixtures_are_valid(self):
        for session in self.sessions().values():
            validate_session(session)
