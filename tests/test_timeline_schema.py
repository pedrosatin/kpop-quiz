"""Unit tests for timeline puzzle schema v1 and validation."""

from __future__ import annotations

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

try:
    import fastjsonschema
except ImportError:
    fastjsonschema = None

from kpop_scraping.timeline_schema import (
    TIMELINE_SCHEMA_VERSION,
    compute_timeline_puzzle_id,
    validate_timeline_puzzle,
    write_timeline_puzzle_atomic,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent / "schemas" / "timeline-puzzle-v1.json"
)


def sample_evidence(fact_id: str = "fb-1", qid: str = "Q21480414") -> dict:
    return {
        "fact_base_id": fact_id,
        "locator": f"claims/P31/{qid}$1234/references/hash1",
        "revision_id": 1001,
        "source_key": "wikidata",
        "source_url": f"https://www.wikidata.org/wiki/{qid}",
    }


def sample_timeline_puzzle() -> dict:
    """Return a complete, valid sample timeline puzzle with 5 strictly ordered events."""
    events = [
        {
            "id": "Q489816-debut",
            "event_type": "debut",
            "date": "2007-03-29",
            "year": 2007,
            "display_date": {
                "pt-BR": "29 de março de 2007",
                "en": "March 29, 2007",
            },
            "title": {
                "pt-BR": "Estreia do grupo KARA",
                "en": "KARA Group Debut",
            },
            "description": {
                "pt-BR": "O grupo feminino KARA estreia com o álbum The First Blooming.",
                "en": "Girl group KARA debuts with album The First Blooming.",
            },
            "entity_id": "Q489816",
            "entity_name": "KARA",
            "evidence": [sample_evidence("fb-kara", "Q489816")],
        },
        {
            "id": "Q21480414-debut",
            "event_type": "debut",
            "date": "2015-10-20",
            "year": 2015,
            "display_date": {
                "pt-BR": "20 de outubro de 2015",
                "en": "October 20, 2015",
            },
            "title": {
                "pt-BR": "Estreia do grupo TWICE",
                "en": "TWICE Group Debut",
            },
            "description": {
                "pt-BR": "TWICE estreia oficialmente pela JYP Entertainment com Like OOH-AHH.",
                "en": "TWICE officially debuts under JYP Entertainment with Like OOH-AHH.",
            },
            "entity_id": "Q21480414",
            "entity_name": "TWICE",
            "evidence": [sample_evidence("fb-twice", "Q21480414")],
        },
        {
            "id": "Q2625142-debut",
            "event_type": "debut",
            "date": "2016-08-08",
            "year": 2016,
            "display_date": {
                "pt-BR": "8 de agosto de 2016",
                "en": "August 8, 2016",
            },
            "title": {
                "pt-BR": "Estreia do grupo BLACKPINK",
                "en": "BLACKPINK Group Debut",
            },
            "description": {
                "pt-BR": "BLACKPINK estreia pela YG Entertainment com Square One.",
                "en": "BLACKPINK debuts under YG Entertainment with Square One.",
            },
            "entity_id": "Q2625142",
            "entity_name": "BLACKPINK",
            "evidence": [sample_evidence("fb-bp", "Q2625142")],
        },
        {
            "id": "Q60738096-debut",
            "event_type": "debut",
            "date": "2019-02-12",
            "year": 2019,
            "display_date": {
                "pt-BR": "12 de fevereiro de 2019",
                "en": "February 12, 2019",
            },
            "title": {
                "pt-BR": "Estreia do grupo ITZY",
                "en": "ITZY Group Debut",
            },
            "description": {
                "pt-BR": "ITZY estreia pela JYP Entertainment com o single Dalla Dalla.",
                "en": "ITZY debuts under JYP Entertainment with single Dalla Dalla.",
            },
            "entity_id": "Q60738096",
            "entity_name": "ITZY",
            "evidence": [sample_evidence("fb-itzy", "Q60738096")],
        },
        {
            "id": "Q100877964-debut",
            "event_type": "debut",
            "date": "2020-11-17",
            "year": 2020,
            "display_date": {
                "pt-BR": "17 de novembro de 2020",
                "en": "November 17, 2020",
            },
            "title": {
                "pt-BR": "Estreia do grupo aespa",
                "en": "aespa Group Debut",
            },
            "description": {
                "pt-BR": "aespa estreia pela SM Entertainment com o single digital Black Mamba.",
                "en": "aespa debuts under SM Entertainment with digital single Black Mamba.",
            },
            "entity_id": "Q100877964",
            "entity_name": "aespa",
            "evidence": [sample_evidence("fb-aespa", "Q100877964")],
        },
    ]

    base = {
        "schema_version": TIMELINE_SCHEMA_VERSION,
        "puzzle_id": "0" * 64,
        "dataset_version": "a" * 64,
        "reference_date": "2026-09-18",
        "theme": {
            "pt-BR": "Estreias de Grandes Grupos Femininos",
            "en": "Major Girl Group Debuts",
        },
        "theme_description": {
            "pt-BR": "Ordene os anos e datas de estreia de grupos femininos de diferentes gerações.",
            "en": "Order debut years and dates of girl groups across generations.",
        },
        "events": events,
    }
    base["puzzle_id"] = compute_timeline_puzzle_id(base)
    return base


class TestTimelineSchema(unittest.TestCase):
    def setUp(self) -> None:
        self.valid_payload = sample_timeline_puzzle()
        if fastjsonschema is not None and SCHEMA_PATH.exists():
            with open(SCHEMA_PATH, encoding="utf-8") as f:
                schema_json = json.load(f)
            self.json_validator = fastjsonschema.compile(schema_json)
        else:
            self.json_validator = None

    def test_valid_payload_passes_python_validator(self) -> None:
        validate_timeline_puzzle(self.valid_payload)

    def test_valid_payload_passes_jsonschema(self) -> None:
        if self.json_validator is not None:
            self.json_validator(self.valid_payload)

    def test_invalid_schema_version(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["schema_version"] = "wrong-version"
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("schema_version", str(ctx.exception))

    def test_missing_root_field(self) -> None:
        payload = deepcopy(self.valid_payload)
        del payload["theme"]
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("root fields must be", str(ctx.exception))

    def test_unexpected_root_field(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["unexpected"] = "bonus"
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("root fields must be", str(ctx.exception))

    def test_invalid_puzzle_id_hash(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["puzzle_id"] = "not-a-hash"
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("puzzle_id", str(ctx.exception))

    def test_invalid_reference_date(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["reference_date"] = "2026-02-31"
        with self.assertRaises(ValueError):
            validate_timeline_puzzle(payload)

    def test_events_count_limits(self) -> None:
        # Less than 4 events
        payload = deepcopy(self.valid_payload)
        payload["events"] = payload["events"][:3]
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("events must contain between 4 and 6 items", str(ctx.exception))

    def test_duplicate_event_ids_rejected(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["events"][1]["id"] = payload["events"][0]["id"]
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("is duplicated", str(ctx.exception))

    def test_strict_chronological_ordering_enforced(self) -> None:
        payload = deepcopy(self.valid_payload)
        # Swap events 0 and 1 so 2015 comes before 2007
        payload["events"][0], payload["events"][1] = (
            payload["events"][1],
            payload["events"][0],
        )
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("must be strictly greater than preceding event date", str(ctx.exception))

    def test_identical_dates_rejected(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["events"][1]["date"] = payload["events"][0]["date"]
        payload["events"][1]["year"] = payload["events"][0]["year"]
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("must be strictly greater than preceding event date", str(ctx.exception))

    def test_invalid_event_type(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["events"][0]["event_type"] = "unknown_type"
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("event_type must be one of", str(ctx.exception))

    def test_year_must_match_date_prefix(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["events"][0]["year"] = 2008  # Date is 2007-03-29
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("must match year in date", str(ctx.exception))

    def test_invalid_entity_id_qid(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["events"][0]["entity_id"] = "P123"
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("entity_id", str(ctx.exception))

    def test_invalid_evidence_url(self) -> None:
        payload = deepcopy(self.valid_payload)
        payload["events"][0]["evidence"][0]["source_url"] = "http://insecure.com"
        with self.assertRaises(ValueError) as ctx:
            validate_timeline_puzzle(payload)
        self.assertIn("source_url must be a valid https URL", str(ctx.exception))

    def test_compute_puzzle_id_deterministic(self) -> None:
        payload = sample_timeline_puzzle()
        hash1 = compute_timeline_puzzle_id(payload)
        payload["puzzle_id"] = "dummy"
        hash2 = compute_timeline_puzzle_id(payload)
        self.assertEqual(hash1, hash2)
        self.assertEqual(len(hash1), 64)

    def test_atomic_write(self) -> None:
        payload = sample_timeline_puzzle()
        with tempfile.TemporaryDirectory() as tmp_dir:
            out_file = Path(tmp_dir) / "timeline.daily.json"
            write_timeline_puzzle_atomic(out_file, payload)
            self.assertTrue(out_file.exists())
            with open(out_file, encoding="utf-8") as f:
                loaded = json.load(f)
            self.assertEqual(loaded["schema_version"], TIMELINE_SCHEMA_VERSION)
            self.assertEqual(len(loaded["events"]), 5)


if __name__ == "__main__":
    unittest.main()
