import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import web_publish
from kpop_scraping.connections_schema import validate_connections_puzzle
from kpop_scraping.grid_schema import validate_intersection_grid
from kpop_scraping.name_guess_schema import validate_name_guess_puzzle
from kpop_scraping.word_search_schema import validate_word_search_puzzle
from kpop_scraping.web_publish import (
    CONNECTIONS_DAILY_FILENAME,
    GRID_DAILY_FILENAME,
    NAME_GUESS_DAILY_FILENAME,
    WORD_SEARCH_DAILY_FILENAME,
    build_manifest,
    create_daily_sessions,
    main,
    parse_daily_date,
    publish,
    verify,
)
from kpop_scraping.quiz_generator import generate_dataset
from kpop_scraping.quiz_schema import validate_session
from tests.test_quiz_generator import build_quiz_database


FIXTURES = Path(__file__).parents[1] / "web" / "public" / "data"


class WebPublishTests(unittest.TestCase):
    def sessions(self):
        manifest = json.loads((FIXTURES / "manifest-v2.json").read_text())
        return {
            key: json.loads((FIXTURES / item["path"]).read_text())
            for key, item in manifest["sessions"].items()
        }

    def grid(self):
        return json.loads((FIXTURES / GRID_DAILY_FILENAME).read_text(encoding="utf-8"))

    def connections(self):
        return json.loads((FIXTURES / CONNECTIONS_DAILY_FILENAME).read_text(encoding="utf-8"))

    def name_guess(self):
        return json.loads((FIXTURES / NAME_GUESS_DAILY_FILENAME).read_text(encoding="utf-8"))

    def word_search(self):
        return json.loads((FIXTURES / WORD_SEARCH_DAILY_FILENAME).read_text(encoding="utf-8"))

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
            for mode in ("assisted", "standard", "expert"):
                sessions[f"en.{mode}"]["config"]["seed"] = "next-release"
                sessions[f"en.{mode}"]["session_id"] = str(
                    {"assisted": 1, "standard": 2, "expert": 3}[mode]
                ) * 64
            publish(output, sessions)
            for locale, content in previous_files.items():
                self.assertEqual((output / previous["sessions"][locale]["path"]).read_bytes(), content)

    def test_interrupted_publication_leaves_previous_manifest_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            sessions = self.sessions()
            publish(output, sessions)
            previous_manifest = (output / "manifest-v2.json").read_bytes()
            for mode in ("assisted", "standard", "expert"):
                sessions[f"pt-BR.{mode}"]["config"]["seed"] = "next-release"
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

    def test_rejects_modes_with_different_questions_or_option_order(self):
        sessions = self.sessions()
        sessions["en.expert"]["questions"][0], sessions["en.expert"]["questions"][1] = (
            sessions["en.expert"]["questions"][1],
            sessions["en.expert"]["questions"][0],
        )
        with self.assertRaisesRegex(ValueError, "questions"):
            build_manifest(sessions)

        sessions = self.sessions()
        sessions["en.assisted"]["questions"][0]["options"].reverse()
        with self.assertRaisesRegex(ValueError, "questions"):
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
            with self.assertRaisesRegex(ValueError, "manifest|session"):
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
        validate_intersection_grid(self.grid())
        validate_connections_puzzle(self.connections())
        validate_name_guess_puzzle(self.name_guess())
        validate_word_search_puzzle(self.word_search())

    def test_daily_sessions_determinism_same_date_repeats_hashes(self):
        connection = build_quiz_database()
        try:
            dataset, _ = generate_dataset(connection)
        finally:
            connection.close()

        sessions_a = create_daily_sessions(dataset, "2026-09-16")
        sessions_b = create_daily_sessions(dataset, "2026-09-16")

        self.assertEqual(sessions_a.keys(), sessions_b.keys())
        for key in sessions_a:
            self.assertEqual(sessions_a[key]["session_id"], sessions_b[key]["session_id"])
            hash_a = hashlib.sha256(web_publish._session_bytes(sessions_a[key])).hexdigest()
            hash_b = hashlib.sha256(web_publish._session_bytes(sessions_b[key])).hexdigest()
            self.assertEqual(hash_a, hash_b)
            self.assertEqual(sessions_a[key]["config"]["seed"], "kpop-daily-2026-09-16")

    def test_daily_sessions_different_dates_produce_different_sessions(self):
        connection = build_quiz_database()
        try:
            dataset, _ = generate_dataset(connection)
        finally:
            connection.close()

        sessions_day1 = create_daily_sessions(dataset, "2026-09-16")
        sessions_day2 = create_daily_sessions(dataset, "2026-09-17")

        for key in sessions_day1:
            self.assertNotEqual(
                sessions_day1[key]["session_id"],
                sessions_day2[key]["session_id"],
            )
            hash1 = hashlib.sha256(web_publish._session_bytes(sessions_day1[key])).hexdigest()
            hash2 = hashlib.sha256(web_publish._session_bytes(sessions_day2[key])).hexdigest()
            self.assertNotEqual(hash1, hash2)

    def test_manifest_and_publish_with_base_and_daily_sessions(self):
        connection = build_quiz_database()
        try:
            dataset, _ = generate_dataset(connection)
        finally:
            connection.close()

        base = {
            f"{locale}.{difficulty}": web_publish.create_session(
                dataset,
                web_publish.QuizConfig(locale, "test-seed", play_mode=difficulty),
            )
            for locale in web_publish.LOCALES
            for difficulty in web_publish.DIFFICULTIES
        }
        daily = create_daily_sessions(dataset, "2026-09-16")
        all_sessions = {**base, **daily}

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, all_sessions)
            verify(output)
            manifest = json.loads((output / "manifest-v2.json").read_text())
            self.assertEqual(len(manifest["sessions"]), 12)
            for key in all_sessions:
                self.assertIn(key, manifest["sessions"])
                item = manifest["sessions"][key]
                self.assertEqual(item["path"], f"session.{key}.{item['sha256']}.json")
                self.assertTrue((output / item["path"]).is_file())

    def test_cli_supports_date_option(self):
        connection = build_quiz_database()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db_path = root / "test.db"
            disk = sqlite3.connect(db_path)
            try:
                connection.backup(disk)
            finally:
                disk.close()
                connection.close()

            output = root / "web_data"
            code = main(["--database", str(db_path), "--output-dir", str(output), "--date", "2026-09-16"])
            self.assertEqual(code, 0)
            verify(output)
            manifest = json.loads((output / "manifest-v2.json").read_text())
            self.assertIn("daily.pt-BR.standard", manifest["sessions"])
            self.assertIn("pt-BR.standard", manifest["sessions"])

    def test_parse_daily_date_validation(self):
        self.assertEqual(parse_daily_date("2026-09-16"), "2026-09-16")
        self.assertRegex(parse_daily_date(None), r"^\d{4}-\d{2}-\d{2}$")
        with self.assertRaises(ValueError):
            parse_daily_date("2026-9-16")
        with self.assertRaises(ValueError):
            parse_daily_date("invalid-date")
        with self.assertRaises(ValueError):
            parse_daily_date("2026-02-30")

    def test_verify_validates_existing_grid_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), grid=self.grid())
            verify(output)
            verify(output, require_grid=True)

    def test_verify_rejects_corrupted_grid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            (output / GRID_DAILY_FILENAME).write_text("{corrupt json", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "cannot read grid artifact"):
                verify(output)

    def test_verify_rejects_invalid_grid_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            (output / GRID_DAILY_FILENAME).write_text(
                json.dumps({"schema_version": "invalid"}), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                verify(output)

    def test_verify_fails_when_grid_required_and_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            with self.assertRaisesRegex(ValueError, "missing required grid artifact"):
                verify(output, require_grid=True)

    def test_verify_permits_missing_grid_when_require_grid_is_false(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            verify(output, require_grid=False)
            verify(output)

    def test_publish_with_grid_writes_atomically_and_verifies_with_require_grid(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), grid=self.grid())
            grid_path = output / GRID_DAILY_FILENAME
            self.assertTrue(grid_path.is_file())
            self.assertEqual(grid_path.read_bytes()[-1:], b"\n")
            verify(output, require_grid=True)

    def test_publish_with_invalid_grid_fails_before_creating_grid_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            invalid_grid = {"schema_version": "invalid"}
            with self.assertRaises(ValueError):
                publish(output, self.sessions(), grid=invalid_grid)
            self.assertFalse((output / GRID_DAILY_FILENAME).exists())

    def test_cli_verify_with_require_grid(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            code_missing = main(["--output-dir", str(output), "--verify", "--require-grid"])
            self.assertEqual(code_missing, 1)

            publish(output, self.sessions(), grid=self.grid())
            code_present = main(["--output-dir", str(output), "--verify", "--require-grid"])
            self.assertEqual(code_present, 0)

    def test_cli_require_grid_without_verify_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            code = main(["--output-dir", str(output), "--require-grid"])
            self.assertEqual(code, 1)

    def test_verify_validates_existing_connections_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), connections=self.connections())
            verify(output)
            verify(output, require_connections=True)

    def test_verify_detects_corrupted_or_invalid_connections_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            (output / CONNECTIONS_DAILY_FILENAME).write_text("{corrupt json", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "cannot read connections artifact"):
                verify(output)

            (output / CONNECTIONS_DAILY_FILENAME).write_text(
                json.dumps({"schema_version": "invalid"}), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                verify(output)

    def test_verify_require_connections_fails_when_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            with self.assertRaisesRegex(ValueError, "missing required connections artifact"):
                verify(output, require_connections=True)

    def test_verify_require_connections_false_passes_when_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            verify(output, require_connections=False)
            verify(output)

    def test_publish_with_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), connections=self.connections())
            conn_path = output / CONNECTIONS_DAILY_FILENAME
            self.assertTrue(conn_path.is_file())
            self.assertEqual(conn_path.read_bytes()[-1:], b"\n")
            verify(output, require_connections=True)

    def test_publish_with_invalid_connections_fails_before_creating_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            invalid_connections = {"schema_version": "invalid"}
            with self.assertRaises(ValueError):
                publish(output, self.sessions(), connections=invalid_connections)
            self.assertFalse((output / CONNECTIONS_DAILY_FILENAME).exists())

    def test_cli_require_connections_without_verify_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            code = main(["--output-dir", str(output), "--require-connections"])
            self.assertEqual(code, 1)

    def test_cli_verify_with_require_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            code_missing = main(["--output-dir", str(output), "--verify", "--require-connections"])
            self.assertEqual(code_missing, 1)

            publish(output, self.sessions(), connections=self.connections())
            code_present = main(["--output-dir", str(output), "--verify", "--require-connections"])
            self.assertEqual(code_present, 0)

            publish(output, self.sessions(), grid=self.grid(), connections=self.connections())
            code_both = main(
                ["--output-dir", str(output), "--verify", "--require-grid", "--require-connections"]
            )
            self.assertEqual(code_both, 0)

    def test_verify_validates_existing_name_guess_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), name_guess=self.name_guess())
            verify(output)
            verify(output, require_name_guess=True)

    def test_verify_detects_corrupted_or_invalid_name_guess_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            (output / NAME_GUESS_DAILY_FILENAME).write_text("{corrupt json", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "cannot read name-guess artifact"):
                verify(output)

            (output / NAME_GUESS_DAILY_FILENAME).write_text(
                json.dumps({"schema_version": "invalid"}), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                verify(output)

    def test_verify_require_name_guess_fails_when_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            with self.assertRaisesRegex(ValueError, "missing required name-guess artifact"):
                verify(output, require_name_guess=True)

    def test_verify_require_name_guess_false_passes_when_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            verify(output, require_name_guess=False)
            verify(output)

    def test_publish_with_name_guess(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), name_guess=self.name_guess())
            puzzle_path = output / NAME_GUESS_DAILY_FILENAME
            self.assertTrue(puzzle_path.is_file())
            self.assertEqual(puzzle_path.read_bytes()[-1:], b"\n")
            verify(output, require_name_guess=True)

    def test_publish_with_invalid_name_guess_fails_before_creating_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            invalid_puzzle = {"schema_version": "invalid"}
            with self.assertRaises(ValueError):
                publish(output, self.sessions(), name_guess=invalid_puzzle)
            self.assertFalse((output / NAME_GUESS_DAILY_FILENAME).exists())

    def test_cli_require_name_guess_without_verify_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            code = main(["--output-dir", str(output), "--require-name-guess"])
            self.assertEqual(code, 1)

    def test_cli_verify_with_require_name_guess(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            code_missing = main(["--output-dir", str(output), "--verify", "--require-name-guess"])
            self.assertEqual(code_missing, 1)

            publish(output, self.sessions(), name_guess=self.name_guess())
            code_present = main(["--output-dir", str(output), "--verify", "--require-name-guess"])
            self.assertEqual(code_present, 0)

            publish(
                output,
                self.sessions(),
                grid=self.grid(),
                connections=self.connections(),
                name_guess=self.name_guess(),
            )
            code_all = main(
                [
                    "--output-dir",
                    str(output),
                    "--verify",
                    "--require-grid",
                    "--require-connections",
                    "--require-name-guess",
                ]
            )
            self.assertEqual(code_all, 0)

    def test_verify_validates_existing_word_search_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), word_search=self.word_search())
            verify(output)
            verify(output, require_word_search=True)

    def test_verify_detects_corrupted_or_invalid_word_search_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            (output / WORD_SEARCH_DAILY_FILENAME).write_text("{corrupt json", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "cannot read word-search artifact"):
                verify(output)

            (output / WORD_SEARCH_DAILY_FILENAME).write_text(
                json.dumps({"schema_version": "invalid"}), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                verify(output)

    def test_verify_require_word_search_fails_when_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            with self.assertRaisesRegex(ValueError, "missing required word-search artifact"):
                verify(output, require_word_search=True)

    def test_verify_require_word_search_false_passes_when_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            verify(output, require_word_search=False)
            verify(output)

    def test_publish_with_word_search(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions(), word_search=self.word_search())
            puzzle_path = output / WORD_SEARCH_DAILY_FILENAME
            self.assertTrue(puzzle_path.is_file())
            self.assertEqual(puzzle_path.read_bytes()[-1:], b"\n")
            verify(output, require_word_search=True)

    def test_publish_with_invalid_word_search_fails_before_creating_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            invalid_puzzle = {"schema_version": "invalid"}
            with self.assertRaises(ValueError):
                publish(output, self.sessions(), word_search=invalid_puzzle)
            self.assertFalse((output / WORD_SEARCH_DAILY_FILENAME).exists())

    def test_cli_require_word_search_without_verify_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            code = main(["--output-dir", str(output), "--require-word-search"])
            self.assertEqual(code, 1)

    def test_cli_verify_with_require_word_search(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            publish(output, self.sessions())
            code_missing = main(["--output-dir", str(output), "--verify", "--require-word-search"])
            self.assertEqual(code_missing, 1)

            publish(output, self.sessions(), word_search=self.word_search())
            code_present = main(["--output-dir", str(output), "--verify", "--require-word-search"])
            self.assertEqual(code_present, 0)

            publish(
                output,
                self.sessions(),
                grid=self.grid(),
                connections=self.connections(),
                name_guess=self.name_guess(),
                word_search=self.word_search(),
            )
            code_all = main(
                [
                    "--output-dir",
                    str(output),
                    "--verify",
                    "--require-grid",
                    "--require-connections",
                    "--require-name-guess",
                    "--require-word-search",
                ]
            )
            self.assertEqual(code_all, 0)

