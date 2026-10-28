"""Related decade clues reach current clients without touching older ones.

A client released before related clues existed rejects the whole session that
carries one, and it reads ``manifest-v2.json`` on every game it starts. The
sessions with those clues are therefore listed in ``manifest-v3.json``; the v2
manifest keeps listing sessions that client accepts.
"""

import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from kpop_scraping.daily_puzzles_runner import NEXT_DIRNAME, _quiz_sessions, run_daily_puzzles
from kpop_scraping.quiz_clue_coverage import published_clue_coverage, published_clue_coverage_lines
from kpop_scraping.quiz_generator import generate_dataset
from kpop_scraping.quiz_schema import validate_legacy_clues, validate_session, write_json_atomic
from kpop_scraping.web_publish import (
    ENRICHED_MANIFEST_FILENAME,
    ENRICHED_MANIFEST_VERSION,
    MANIFEST_FILENAME,
    build_manifest,
    publish,
    validate_enrichment,
    verify,
)
from tests.test_daily_puzzles_runner import build_test_database
from tests.test_quiz_generator import build_quiz_database

SEED = "web-launch-v1"
DAY = "2026-10-12"


def _sessions(related_clues: bool, day: str = DAY) -> dict:
    connection = build_quiz_database()
    try:
        dataset, _ = generate_dataset(connection, related_clues=related_clues)
    finally:
        connection.close()
    return _quiz_sessions(dataset, day, SEED, None)


class EnrichmentContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.legacy = _sessions(False)
        cls.enriched = _sessions(True)

    def test_fixture_has_related_clues_an_older_client_would_reject(self):
        leaking = []
        for key, session in self.enriched.items():
            try:
                validate_legacy_clues(session)
            except ValueError:
                leaking.append(key)
        self.assertTrue(leaking, "the fixture must exercise a clue outside the question's facts")
        for session in self.legacy.values():
            validate_legacy_clues(session)

    def test_enrichment_changes_only_clues_and_keeps_every_identity(self):
        validate_enrichment(self.legacy, self.enriched)
        for key, session in self.legacy.items():
            other = self.enriched[key]
            self.assertEqual(session["session_id"], other["session_id"])
            self.assertEqual(session["dataset_version"], other["dataset_version"])
            self.assertEqual(
                [q["id"] for q in session["questions"]], [q["id"] for q in other["questions"]]
            )
            if session["config"]["play_mode"] == "expert":
                self.assertEqual(session, other)

    def test_enrichment_adds_clues_where_there_were_none_and_never_removes_one(self):
        added = 0
        for key, session in self.legacy.items():
            for before, after in zip(session["questions"], self.enriched[key]["questions"]):
                if before["clues_available"]:
                    self.assertEqual(before["clues_available"], after["clues_available"])
                else:
                    added += bool(after["clues_available"])
        self.assertGreater(added, 0)

    def _tampered(self, change):
        enriched = copy.deepcopy(self.enriched)
        change(enriched)
        return enriched

    def test_rejects_a_change_that_moves_a_session_id(self):
        def change(sessions):
            sessions["daily.en.standard"]["session_id"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "session_id"):
            validate_enrichment(self.legacy, self._tampered(change))

    def test_rejects_a_change_of_question_order_or_identity(self):
        def change(sessions):
            questions = sessions["daily.en.standard"]["questions"]
            questions[0], questions[1] = questions[1], questions[0]
        with self.assertRaisesRegex(ValueError, "changes the questions"):
            validate_enrichment(self.legacy, self._tampered(change))

    def test_rejects_a_change_to_answer_options_or_evidence(self):
        def change(sessions):
            sessions["daily.en.standard"]["questions"][0]["options"][0]["label"] = "Other"
        with self.assertRaisesRegex(ValueError, "more than clues"):
            validate_enrichment(self.legacy, self._tampered(change))

        def change_evidence(sessions):
            sessions["daily.en.standard"]["questions"][0]["evidence"] = []
        with self.assertRaisesRegex(ValueError, "more than clues"):
            validate_enrichment(self.legacy, self._tampered(change_evidence))

    def test_rejects_a_clue_in_expert_mode(self):
        def change(sessions):
            donor = next(
                q for q in sessions["daily.en.standard"]["questions"] if q["clues_available"]
            )
            sessions["daily.en.expert"]["questions"][0]["clues_available"] = donor["clues_available"]
        with self.assertRaisesRegex(ValueError, "expert"):
            validate_enrichment(self.legacy, self._tampered(change))

    def test_rejects_a_changed_existing_clue(self):
        key, index = next(
            (key, index)
            for key, session in self.legacy.items()
            for index, question in enumerate(session["questions"])
            if question["clues_available"]
        )

        def change(sessions):
            question = sessions[key]["questions"][index]
            question["clues_available"] = []
            question["clues_shown"] = []
        with self.assertRaisesRegex(ValueError, "existing clue"):
            validate_enrichment(self.legacy, self._tampered(change))

    def test_rejects_different_session_keys(self):
        partial = {key: value for key, value in self.enriched.items() if key != "daily.en.standard"}
        with self.assertRaisesRegex(ValueError, "same keys"):
            validate_enrichment(self.legacy, partial)


class PublishEnrichedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.legacy = _sessions(False)
        cls.enriched = _sessions(True)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.out = Path(self._tmp.name) / "data"

    def test_v2_manifest_lists_only_sessions_an_older_client_accepts(self):
        publish(self.out, self.legacy, enriched_sessions=self.enriched)
        verify(self.out)
        v2 = json.loads((self.out / MANIFEST_FILENAME).read_text())
        for entry in v2["sessions"].values():
            validate_legacy_clues(json.loads((self.out / entry["path"]).read_text()))
        v3 = json.loads((self.out / ENRICHED_MANIFEST_FILENAME).read_text())
        self.assertEqual(v3["schema_version"], "kpop-quiz-web-manifest-v3")
        self.assertEqual(set(v3["sessions"]), set(v2["sessions"]))
        self.assertEqual(v3["dataset_version"], v2["dataset_version"])
        for key, entry in v3["sessions"].items():
            self.assertEqual(entry["session_id"], v2["sessions"][key]["session_id"])
        # A session without a new clue is the same file in both manifests.
        self.assertTrue(any(v3["sessions"][k] == v2["sessions"][k] for k in v2["sessions"]))
        self.assertTrue(any(v3["sessions"][k] != v2["sessions"][k] for k in v2["sessions"]))

    def test_without_enriched_sessions_the_output_is_the_one_before_this_change(self):
        publish(self.out, self.legacy)
        self.assertFalse((self.out / ENRICHED_MANIFEST_FILENAME).exists())
        verify(self.out)

    def test_enriched_files_never_overwrite_legacy_ones(self):
        publish(self.out, self.legacy)
        before = {path.name: path.read_bytes() for path in self.out.glob("session.*.json")}
        publish(self.out, self.legacy, enriched_sessions=self.enriched)
        for name, content in before.items():
            self.assertEqual((self.out / name).read_bytes(), content)

    def test_refuses_to_list_related_clues_in_the_v2_manifest(self):
        with self.assertRaisesRegex(ValueError, "outside its question"):
            publish(self.out, self.enriched)
        self.assertFalse(self.out.exists())

    def test_verify_refuses_a_v2_manifest_that_lists_a_related_clue(self):
        # Build the leak the way a publisher that bypassed publish() would.
        publish(self.out, self.legacy)
        leaking_key = next(
            key for key, session in self.enriched.items()
            if session != self.legacy[key]
        )
        sessions = dict(self.legacy)
        sessions[leaking_key] = self.enriched[leaking_key]
        manifest = build_manifest(sessions)
        write_json_atomic(
            self.out / manifest["sessions"][leaking_key]["path"], sessions[leaking_key], validate_session
        )
        (self.out / MANIFEST_FILENAME).write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "outside its question"):
            verify(self.out)

    def test_verify_refuses_a_v3_manifest_that_disagrees_with_v2(self):
        publish(self.out, self.legacy, enriched_sessions=self.enriched)
        path = self.out / ENRICHED_MANIFEST_FILENAME
        v3 = json.loads(path.read_text())
        sessions = {
            key: json.loads((self.out / entry["path"]).read_text())
            for key, entry in v3["sessions"].items()
        }
        sessions["daily.en.standard"]["session_id"] = "0" * 64
        manifest = build_manifest(sessions, ENRICHED_MANIFEST_VERSION)
        write_json_atomic(
            self.out / manifest["sessions"]["daily.en.standard"]["path"],
            sessions["daily.en.standard"],
            validate_session,
        )
        path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "session_id"):
            verify(self.out)

    def test_coverage_is_reported_for_each_kind_of_client(self):
        publish(self.out, self.legacy, enriched_sessions=self.enriched)
        legacy = published_clue_coverage(self.out)
        enriched = published_clue_coverage(self.out, ENRICHED_MANIFEST_FILENAME)
        for mode in ("assisted", "standard"):
            self.assertGreater(
                enriched["by_mode"][mode]["with_clue"], legacy["by_mode"][mode]["with_clue"]
            )
        self.assertEqual(enriched["by_mode"]["expert"]["with_clue"], 0)
        text = "\n".join(published_clue_coverage_lines(self.out, "Quiz clues"))
        self.assertIn("manifest-v2, clients without related clues", text)
        self.assertIn("manifest-v3, current clients", text)


class DailyRunEnrichedTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.db = self.root / "kpop.db"
        build_test_database(self.db).close()
        # The runner's database fills the other games but yields no related
        # clue, so the quiz comes from the one that does; the seam is the
        # dataset, which is all the runner takes from the quiz generator.
        self.quiz_connection = build_quiz_database()
        self.addCleanup(self.quiz_connection.close)
        patcher = patch(
            "kpop_scraping.daily_puzzles_runner.generate_dataset",
            side_effect=lambda connection, **kwargs: generate_dataset(self.quiz_connection, **kwargs),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_day(self, out: Path, day: str, **kwargs):
        return run_daily_puzzles(self.db, out, reference_date=day, **kwargs)

    @staticmethod
    def files(directory: Path, skip: set[str] = frozenset()) -> dict[str, bytes]:
        return {
            path.name: path.read_bytes()
            for path in sorted(directory.glob("*.json"))
            if path.name not in skip
        }

    def test_the_legacy_artifacts_are_the_same_with_or_without_the_flag(self):
        off, on = self.root / "off", self.root / "on"
        self.run_day(off, DAY, ahead=True)
        result = self.run_day(on, DAY, ahead=True, related_clues=True)
        self.assertTrue(result["related_clues"])
        self.assertFalse((off / ENRICHED_MANIFEST_FILENAME).exists())
        self.assertTrue((on / ENRICHED_MANIFEST_FILENAME).is_file())
        v3 = json.loads((on / ENRICHED_MANIFEST_FILENAME).read_text())
        enriched_names = {entry["path"] for entry in v3["sessions"].values()}
        v2_names = {
            entry["path"]
            for entry in json.loads((on / MANIFEST_FILENAME).read_text())["sessions"].values()
        }
        extra = (enriched_names - v2_names) | {ENRICHED_MANIFEST_FILENAME}
        self.assertTrue(enriched_names - v2_names, "the flag must add sessions with clues")
        self.assertEqual(self.files(off), self.files(on, extra))
        # The day published ahead follows the same rule.
        v3_next = json.loads((on / NEXT_DIRNAME / ENRICHED_MANIFEST_FILENAME).read_text())
        extra_next = {
            entry["path"] for entry in v3_next["sessions"].values()
        } - {
            entry["path"]
            for entry in json.loads((on / NEXT_DIRNAME / MANIFEST_FILENAME).read_text())["sessions"].values()
        }
        self.assertEqual(
            self.files(off / NEXT_DIRNAME),
            self.files(on / NEXT_DIRNAME, extra_next | {ENRICHED_MANIFEST_FILENAME}),
        )

    def test_a_day_published_without_the_flag_drops_an_older_enriched_manifest(self):
        out = self.root / "out"
        self.run_day(out, DAY, related_clues=True)
        self.assertTrue((out / ENRICHED_MANIFEST_FILENAME).is_file())
        self.run_day(out, "2026-10-13")
        self.assertFalse(
            (out / ENRICHED_MANIFEST_FILENAME).exists(),
            "a stale manifest-v3 would show the previous day's quiz as today's",
        )
        verify(out)

    def test_promoting_a_next_day_without_clues_drops_the_enriched_manifest(self):
        out = self.root / "out"
        self.run_day(out, DAY, related_clues=True)
        # Day two published ahead by a run without the flag.
        self.run_day(out, DAY, ahead=True)
        self.assertTrue((out / ENRICHED_MANIFEST_FILENAME).is_file())
        self.assertFalse((out / NEXT_DIRNAME / ENRICHED_MANIFEST_FILENAME).exists())
        result = self.run_day(out, "2026-10-13")
        self.assertTrue(result["promoted_from_next"])
        self.assertFalse((out / ENRICHED_MANIFEST_FILENAME).exists())
        verify(out)

    def test_promoting_a_next_day_with_clues_installs_its_enriched_manifest(self):
        out = self.root / "out"
        self.run_day(out, DAY, ahead=True, related_clues=True)
        next_manifest = (out / NEXT_DIRNAME / ENRICHED_MANIFEST_FILENAME).read_bytes()
        result = self.run_day(out, "2026-10-13")
        self.assertTrue(result["promoted_from_next"])
        self.assertEqual((out / ENRICHED_MANIFEST_FILENAME).read_bytes(), next_manifest)
        verify(out)

    def test_an_already_published_day_keeps_its_bytes_when_the_flag_turns_on(self):
        out = self.root / "out"
        self.run_day(out, DAY)
        before = self.files(out)
        result = self.run_day(out, DAY, related_clues=True)
        self.assertTrue(result["already_published"])
        self.assertEqual(self.files(out), before)

    def test_turning_the_flag_off_again_restores_what_clients_read(self):
        out = self.root / "out"
        self.run_day(out, DAY, related_clues=True)
        self.run_day(out, DAY, regenerate=True)
        self.assertFalse((out / ENRICHED_MANIFEST_FILENAME).exists())
        verify(out)


if __name__ == "__main__":
    unittest.main()
