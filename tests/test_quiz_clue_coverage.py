import json
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.quiz_clue_coverage import (
    format_clue_coverage,
    published_clue_coverage,
    session_clue_coverage,
)


def _session(mode, clue_flags):
    return {
        "config": {"play_mode": mode},
        "questions": [{"clues_available": [{"id": "c"}] if flag else []} for flag in clue_flags],
    }


class QuizClueCoverageTest(unittest.TestCase):
    def test_counts_questions_and_sessions_by_mode(self):
        coverage = session_clue_coverage({
            "daily.en.assisted": _session("assisted", [False, False]),
            "decade.2000.en.assisted": _session("assisted", [True, False]),
            "decade.2000.en.standard": _session("standard", [True, True]),
            "decade.2000.en.expert": _session("expert", [False, False]),
        })
        self.assertEqual(
            coverage["by_mode"]["assisted"],
            {"sessions": 2, "sessions_with_clue": 1, "questions": 4, "with_clue": 1},
        )
        self.assertEqual(coverage["by_mode"]["standard"]["with_clue"], 2)
        self.assertEqual(coverage["by_mode"]["expert"]["with_clue"], 0)
        self.assertEqual(coverage["sessions_without_clue"], ["daily.en.assisted"])

    def test_expert_sessions_without_clues_are_not_reported_as_missing(self):
        coverage = session_clue_coverage({"x.expert": _session("expert", [False])})
        self.assertEqual(coverage["sessions_without_clue"], [])
        self.assertIn("no clues by design", format_clue_coverage(coverage, "Q")[2])

    def test_reads_published_directory(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            (directory / "s.json").write_text(json.dumps(_session("standard", [True, False])))
            (directory / "manifest-v2.json").write_text(
                json.dumps({"sessions": {"daily.en.standard": {"path": "s.json"}}})
            )
            coverage = published_clue_coverage(directory)
        self.assertEqual(coverage["by_mode"]["standard"]["with_clue"], 1)
        self.assertEqual(
            format_clue_coverage(coverage, "Q")[1],
            "Q standard: 1/2 questions with a clue, 1/1 sessions with at least one",
        )


if __name__ == "__main__":
    unittest.main()
