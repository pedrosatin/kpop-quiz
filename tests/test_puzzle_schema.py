"""Characterization tests for the validators shared by the puzzle schemas.

Each game schema keeps its own error prefix, so every shared check is pinned
here through the module that calls it, with the full message it raises.
"""

from __future__ import annotations

import unittest
from typing import Any, Callable

from kpop_scraping import (
    connections_generator,
    connections_schema,
    grid_generator,
    grid_schema,
    name_guess_generator,
    name_guess_schema,
    puzzle_schema,
    strands_generator,
    strands_schema,
    timeline_generator,
    timeline_schema,
    word_search_generator,
    word_search_schema,
)
from kpop_scraping.quiz_models import Evidence

PREFIXES = {
    connections_schema: "Invalid connections puzzle schema: ",
    grid_schema: "Invalid grid schema: ",
    name_guess_schema: "Invalid name guess puzzle schema: ",
    strands_schema: "Invalid strands puzzle schema: ",
    timeline_schema: "Invalid timeline puzzle schema: ",
    word_search_schema: "Invalid word search puzzle schema: ",
}
HASH_MODULES = tuple(PREFIXES)
QID_MODULES = (
    connections_schema,
    grid_schema,
    name_guess_schema,
    timeline_schema,
    word_search_schema,
)
BILINGUAL_MODULES = tuple(PREFIXES)
EVIDENCE_MODULES = (connections_schema, grid_schema, name_guess_schema, word_search_schema)
SERIALIZER_MODULES = (
    connections_generator,
    grid_generator,
    name_guess_generator,
    strands_generator,
    timeline_generator,
    word_search_generator,
)

VALID_EVIDENCE = {
    "fact_base_id": "fact-1",
    "locator": "infobox.label",
    "revision_id": 1,
    "source_key": "enwiki:1",
    "source_url": "https://en.wikipedia.org/w/index.php?oldid=1",
}


def _with(**changes: Any) -> dict[str, Any]:
    return {**VALID_EVIDENCE, **changes}


class SharedSchemaChecksTest(unittest.TestCase):
    def assert_rejects(
        self, module: Any, check: Callable[..., None], args: tuple[Any, ...], message: str
    ) -> None:
        with self.assertRaises(ValueError) as caught:
            check(*args)
        self.assertEqual(str(caught.exception), PREFIXES[module] + message)

    def test_require_hash_accepts_lowercase_hex_and_rejects_the_rest(self) -> None:
        message = "puzzle_id must be a 64-character lowercase hex string"
        for module in HASH_MODULES:
            with self.subTest(module=module.__name__):
                module._require_hash("0123456789abcdef" * 4, "puzzle_id")
                for value in ("A" * 64, "a" * 63, 64, None):
                    self.assert_rejects(module, module._require_hash, (value, "puzzle_id"), message)

    def test_require_qid_accepts_wikidata_items_and_rejects_the_rest(self) -> None:
        message = "entity_id must match pattern ^Q[1-9][0-9]*$"
        for module in QID_MODULES:
            with self.subTest(module=module.__name__):
                module._require_qid("Q12", "entity_id")
                for value in ("Q0", "q12", "P31", 12):
                    self.assert_rejects(module, module._require_qid, (value, "entity_id"), message)

    def test_require_bilingual_text_checks_shape_then_each_language(self) -> None:
        cases = (
            ("title", "title must be an object"),
            ({"en": "Title"}, "title fields must be pt-BR and en"),
            ({"pt-BR": "T", "en": "T", "ko": "T"}, "title fields must be pt-BR and en"),
            ({"pt-BR": "", "en": ""}, "title.pt-BR must be a non-empty string"),
            ({"pt-BR": "Título", "en": 3}, "title.en must be a non-empty string"),
        )
        for module in BILINGUAL_MODULES:
            with self.subTest(module=module.__name__):
                module._require_bilingual_text({"pt-BR": "Título", "en": "Title"}, "title")
                for value, message in cases:
                    self.assert_rejects(
                        module, module._require_bilingual_text, (value, "title"), message
                    )

    def test_validate_evidence_reports_the_first_failing_field(self) -> None:
        cases = (
            (["fact-1"], "cell[0] evidence item must be an object"),
            (_with(extra="x"), "cell[0] evidence item contains unexpected or missing fields"),
            (_with(fact_base_id="", locator=""), "cell[0] fact_base_id must be a non-empty string"),
            (_with(locator="", revision_id=0), "cell[0] locator must be a non-empty string"),
            (_with(revision_id=0), "cell[0] revision_id must be an integer >= 1"),
            (_with(revision_id=True), "cell[0] revision_id must be an integer >= 1"),
            (_with(revision_id="1"), "cell[0] revision_id must be an integer >= 1"),
            (_with(source_key=""), "cell[0] source_key must be a non-empty string"),
            (_with(source_url="http://en.wikipedia.org/"), "cell[0] source_url must be an https URL"),
            (_with(source_url="https://"), "cell[0] source_url netloc cannot be empty"),
        )
        for module in EVIDENCE_MODULES:
            with self.subTest(module=module.__name__):
                module._validate_evidence(dict(VALID_EVIDENCE), "cell[0]")
                for evidence, message in cases:
                    self.assert_rejects(
                        module, module._validate_evidence, (evidence, "cell[0]"), message
                    )


class SerializeEvidenceTest(unittest.TestCase):
    def test_deduplicates_and_sorts_by_every_field(self) -> None:
        late = Evidence("fact-2", "enwiki:2", "infobox.label", "https://a.example/2", 7)
        early = Evidence("fact-1", "enwiki:1", "lead", "https://a.example/1", 9)
        same_fact_other_revision = Evidence("fact-1", "enwiki:1", "lead", "https://a.example/1", 3)
        expected = [
            {
                "fact_base_id": "fact-1",
                "locator": "lead",
                "revision_id": 3,
                "source_key": "enwiki:1",
                "source_url": "https://a.example/1",
            },
            {
                "fact_base_id": "fact-1",
                "locator": "lead",
                "revision_id": 9,
                "source_key": "enwiki:1",
                "source_url": "https://a.example/1",
            },
            {
                "fact_base_id": "fact-2",
                "locator": "infobox.label",
                "revision_id": 7,
                "source_key": "enwiki:2",
                "source_url": "https://a.example/2",
            },
        ]
        serialized = puzzle_schema.serialize_evidence(
            iter([late, early, late, same_fact_other_revision])
        )
        self.assertEqual(serialized, expected)
        self.assertEqual(
            [list(item) for item in serialized],
            [["fact_base_id", "locator", "revision_id", "source_key", "source_url"]] * 3,
        )

    def test_empty_input_serializes_to_empty_list(self) -> None:
        self.assertEqual(puzzle_schema.serialize_evidence([]), [])

    def test_every_generator_uses_the_shared_serializer(self) -> None:
        for module in SERIALIZER_MODULES:
            with self.subTest(module=module.__name__):
                self.assertIs(module.serialize_evidence, puzzle_schema.serialize_evidence)


if __name__ == "__main__":
    unittest.main()
