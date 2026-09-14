import json
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.web_publish import build_manifest, main, publish, verify
from kpop_scraping.quiz_schema import validate_session


FIXTURES = Path(__file__).parents[1] / "web" / "public" / "data"


class WebPublishTests(unittest.TestCase):
    def sessions(self):
        return {
            locale: json.loads((FIXTURES / f"session.{locale}.json").read_text())
            for locale in ("pt-BR", "en")
        }

    def test_publishes_and_verifies_canonical_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            verify(output)
            self.assertEqual((output / "manifest.json").read_bytes()[-1:], b"\n")

    def test_rejects_locale_mismatch(self):
        sessions = self.sessions()
        sessions["en"] = sessions["pt-BR"]
        with self.assertRaisesRegex(ValueError, "language"):
            build_manifest(sessions)

    def test_rejects_dataset_version_mismatch(self):
        sessions = self.sessions()
        sessions["en"]["dataset_version"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "one dataset"):
            build_manifest(sessions)

    def test_verify_detects_changed_session(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            payload = json.loads((output / "session.en.json").read_text())
            payload["config"]["seed"] = "changed"
            (output / "session.en.json").write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "manifest"):
                verify(output)

    def test_invalid_input_does_not_replace_existing_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            before = {path.name: path.read_bytes() for path in output.iterdir()}
            sessions = self.sessions()
            sessions["en"]["questions"] = []
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
            (output / "session.en.json").unlink()
            with self.assertRaisesRegex(ValueError, "cannot read session"):
                verify(output)
            publish(output, self.sessions())
            (output / "session.en.json").write_bytes((output / "session.pt-BR.json").read_bytes())
            with self.assertRaisesRegex(ValueError, "language"):
                verify(output)

    def test_cli_requires_a_complete_source(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(main(["--output-dir", directory]), 1)

    def test_checked_in_fixtures_are_valid(self):
        for session in self.sessions().values():
            validate_session(session)
