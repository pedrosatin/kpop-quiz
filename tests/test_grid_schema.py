"""Unit tests for intersection grid schema v1 and validation."""

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

import fastjsonschema

from kpop_scraping.grid_schema import (
    GRID_CATEGORIES,
    GRID_SCHEMA_VERSION,
    validate_intersection_grid,
    write_intersection_grid_atomic,
)

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "intersection-grid-v1.json"


def sample_evidence(fact_id: str = "fb-1") -> dict:
    return {
        "fact_base_id": fact_id,
        "locator": "claims/P264/Q21461452$1234/references/hash1",
        "revision_id": 1001,
        "source_key": "wikidata",
        "source_url": "https://www.wikidata.org/wiki/Q21461452",
    }


def sample_intersection_grid() -> dict:
    """Return a complete, valid sample intersection grid matching schemas/intersection-grid-v1.json."""
    row_criteria = [
        {
            "id": "row_formed_2010s",
            "category": "formed_on",
            "label": {
                "pt-BR": "Estreou nos anos 2010",
                "en": "Debuted in the 2010s",
            },
        },
        {
            "id": "row_formed_2000s",
            "category": "formed_on",
            "label": {
                "pt-BR": "Estreou nos anos 2000",
                "en": "Debuted in the 2000s",
            },
        },
        {
            "id": "row_members_4",
            "category": "has_member",
            "label": {
                "pt-BR": "4 integrantes",
                "en": "4 members",
            },
        },
    ]

    col_criteria = [
        {
            "id": "col_jyp",
            "category": "record_label",
            "label": {
                "pt-BR": "JYP Entertainment",
                "en": "JYP Entertainment",
            },
        },
        {
            "id": "col_sm",
            "category": "record_label",
            "label": {
                "pt-BR": "SM Entertainment",
                "en": "SM Entertainment",
            },
        },
        {
            "id": "col_yg",
            "category": "record_label",
            "label": {
                "pt-BR": "YG Entertainment",
                "en": "YG Entertainment",
            },
        },
    ]

    # 9 cells: (row_index, col_index) for all combinations
    cell_answers = {
        (0, 0): ["Q21461452", "Q15629342"],  # 2010s + JYP: TWICE, GOT7
        (0, 1): ["Q494217", "Q17466548"],    # 2010s + SM: EXO, Red Velvet
        (0, 2): ["Q25056705", "Q14896798"],  # 2010s + YG: BLACKPINK, WINNER
        (1, 0): ["Q484432", "Q489898"],      # 2000s + JYP: Wonder Girls, 2PM
        (1, 1): ["Q20153", "Q243884"],       # 2000s + SM: Girls' Generation, SHINee
        (1, 2): ["Q282287", "Q483257"],      # 2000s + YG: BIGBANG, 2NE1
        (2, 0): ["Q284897"],                 # 4 members + JYP: Miss A
        (2, 1): ["Q100877991"],              # 4 members + SM: aespa
        (2, 2): ["Q25056705", "Q483257"],    # 4 members + YG: BLACKPINK, 2NE1
    }

    cells = []
    for r in range(3):
        for c in range(3):
            cells.append(
                {
                    "row_index": r,
                    "col_index": c,
                    "valid_entity_ids": cell_answers[(r, c)],
                    "evidence": [sample_evidence(f"fb-{r}-{c}")],
                }
            )

    candidate_pool = [
        {
            "id": "Q21461452",
            "canonical_name": "TWICE",
            "names": {"pt-BR": "TWICE", "en": "TWICE"},
        },
        {
            "id": "Q15629342",
            "canonical_name": "GOT7",
            "names": {"pt-BR": "GOT7", "en": "GOT7"},
        },
        {
            "id": "Q494217",
            "canonical_name": "EXO",
            "names": {"pt-BR": "EXO", "en": "EXO"},
        },
        {
            "id": "Q17466548",
            "canonical_name": "Red Velvet",
            "names": {"pt-BR": "Red Velvet", "en": "Red Velvet"},
        },
        {
            "id": "Q25056705",
            "canonical_name": "BLACKPINK",
            "names": {"pt-BR": "BLACKPINK", "en": "BLACKPINK"},
        },
        {
            "id": "Q14896798",
            "canonical_name": "WINNER",
            "names": {"pt-BR": "WINNER", "en": "WINNER"},
        },
        {
            "id": "Q484432",
            "canonical_name": "Wonder Girls",
            "names": {"pt-BR": "Wonder Girls", "en": "Wonder Girls"},
        },
        {
            "id": "Q489898",
            "canonical_name": "2PM",
            "names": {"pt-BR": "2PM", "en": "2PM"},
        },
        {
            "id": "Q20153",
            "canonical_name": "Girls' Generation",
            "names": {"pt-BR": "Girls' Generation", "en": "Girls' Generation"},
        },
        {
            "id": "Q243884",
            "canonical_name": "SHINee",
            "names": {"pt-BR": "SHINee", "en": "SHINee"},
        },
        {
            "id": "Q282287",
            "canonical_name": "BIGBANG",
            "names": {"pt-BR": "BIGBANG", "en": "BIGBANG"},
        },
        {
            "id": "Q483257",
            "canonical_name": "2NE1",
            "names": {"pt-BR": "2NE1", "en": "2NE1"},
        },
        {
            "id": "Q284897",
            "canonical_name": "Miss A",
            "names": {"pt-BR": "Miss A", "en": "Miss A"},
        },
        {
            "id": "Q100877991",
            "canonical_name": "aespa",
            "names": {"pt-BR": "aespa", "en": "aespa"},
        },
    ]

    return {
        "schema_version": GRID_SCHEMA_VERSION,
        "grid_id": "a" * 64,
        "dataset_version": "b" * 64,
        "reference_date": "2026-09-17",
        "dimensions": {
            "rows": 3,
            "cols": 3,
        },
        "row_criteria": row_criteria,
        "col_criteria": col_criteria,
        "cells": cells,
        "candidate_pool": candidate_pool,
    }


with open(SCHEMA_PATH, "r", encoding="utf-8") as _f:
    SCHEMA_JSON = json.load(_f)

JSON_VALIDATOR = fastjsonschema.compile(SCHEMA_JSON)


class IntersectionGridSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SCHEMA_PATH.exists(), f"Schema file not found at {SCHEMA_PATH}"
        cls.schema_json = SCHEMA_JSON
        cls.json_validator = staticmethod(JSON_VALIDATOR)

    def test_schema_metadata(self):
        self.assertEqual(
            self.schema_json.get("$schema"),
            "https://json-schema.org/draft/2020-12/schema",
        )
        self.assertEqual(
            self.schema_json.get("$id"),
            "https://kpop-quiz.local/schemas/intersection-grid-v1.json",
        )
        self.assertFalse(self.schema_json.get("additionalProperties", True))
        categories = set(
            self.schema_json["$defs"]["criterion"]["properties"]["category"]["enum"]
        )
        self.assertEqual(categories, GRID_CATEGORIES)

    def test_valid_fixture_passes_schema_and_domain_validator(self):
        fixture = sample_intersection_grid()
        # JSON schema validation
        validated = JSON_VALIDATOR(fixture)
        self.assertIsInstance(validated, dict)
        # Python domain validation
        validate_intersection_grid(fixture)

    def test_cell_without_valid_answers_fails_validation(self):
        fixture = sample_intersection_grid()
        fixture["cells"][0]["valid_entity_ids"] = []

        # JSON schema check
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)

        # Domain validator check
        with self.assertRaises(ValueError) as ctx:
            validate_intersection_grid(fixture)
        self.assertIn("valid_entity_ids must not be empty", str(ctx.exception))

    def test_missing_root_fields_fail(self):
        required_fields = [
            "schema_version",
            "grid_id",
            "dataset_version",
            "reference_date",
            "dimensions",
            "row_criteria",
            "col_criteria",
            "cells",
            "candidate_pool",
        ]
        for field in required_fields:
            with self.subTest(field=field):
                fixture = sample_intersection_grid()
                del fixture[field]

                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    self.json_validator(fixture)

                with self.assertRaises(ValueError) as ctx:
                    validate_intersection_grid(fixture)
                self.assertIn("missing or extra fields", str(ctx.exception))

    def test_extra_root_field_fails_strict_validation(self):
        fixture = sample_intersection_grid()
        fixture["unexpected_field"] = "disallowed"

        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)

        with self.assertRaises(ValueError) as ctx:
            validate_intersection_grid(fixture)
        self.assertIn("missing or extra fields", str(ctx.exception))

    def test_invalid_schema_version_fails(self):
        fixture = sample_intersection_grid()
        fixture["schema_version"] = "kpop-intersection-grid-v2"

        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)

        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_invalid_hashes_fail(self):
        for field in ("grid_id", "dataset_version"):
            with self.subTest(field=field):
                fixture = sample_intersection_grid()
                fixture[field] = "not-a-64-char-hex-hash"

                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    self.json_validator(fixture)

                with self.assertRaises(ValueError):
                    validate_intersection_grid(fixture)

    def test_invalid_reference_date_fails(self):
        for invalid_date in ("2026/09/17", "not-a-date", "2026-02-30"):
            with self.subTest(date=invalid_date):
                fixture = sample_intersection_grid()
                fixture["reference_date"] = invalid_date

                with self.assertRaises((fastjsonschema.JsonSchemaException, ValueError)):
                    validate_intersection_grid(fixture)

    def test_invalid_dimensions_fail(self):
        # Rows not 3
        fixture = sample_intersection_grid()
        fixture["dimensions"]["rows"] = 4
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # Cols not 3
        fixture = sample_intersection_grid()
        fixture["dimensions"]["cols"] = 2
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_criteria_count_must_be_exactly_three(self):
        for criteria_key in ("row_criteria", "col_criteria"):
            with self.subTest(key=criteria_key):
                # 2 criteria (too few)
                fixture = sample_intersection_grid()
                fixture[criteria_key] = fixture[criteria_key][:2]
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_intersection_grid(fixture)

                # 4 criteria (too many)
                fixture = sample_intersection_grid()
                extra = deepcopy(fixture[criteria_key][0])
                extra["id"] = "extra_criterion"
                fixture[criteria_key].append(extra)
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_intersection_grid(fixture)

    def test_invalid_criterion_category_fails(self):
        fixture = sample_intersection_grid()
        fixture["row_criteria"][0]["category"] = "unsupported_category"

        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)

        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_missing_bilingual_label_fails(self):
        fixture = sample_intersection_grid()
        del fixture["row_criteria"][0]["label"]["en"]

        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)

        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_cells_count_must_be_nine(self):
        # 8 cells
        fixture = sample_intersection_grid()
        fixture["cells"] = fixture["cells"][:8]
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_cell_coordinates_out_of_range_fail(self):
        fixture = sample_intersection_grid()
        fixture["cells"][0]["row_index"] = 3
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_duplicate_cell_coordinates_fail(self):
        fixture = sample_intersection_grid()
        fixture["cells"][1]["row_index"] = 0
        fixture["cells"][1]["col_index"] = 0
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_invalid_qid_in_valid_entity_ids_fails(self):
        for bad_qid in ("P123", "Q0", "12345", "Q_123", ""):
            with self.subTest(bad_qid=bad_qid):
                fixture = sample_intersection_grid()
                fixture["cells"][0]["valid_entity_ids"] = [bad_qid]

                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    self.json_validator(fixture)

                with self.assertRaises(ValueError):
                    validate_intersection_grid(fixture)

    def test_invalid_evidence_fails(self):
        # Missing required field in evidence
        fixture = sample_intersection_grid()
        del fixture["cells"][0]["evidence"][0]["source_url"]

        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)

        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # Insecure source_url
        fixture = sample_intersection_grid()
        fixture["cells"][0]["evidence"][0]["source_url"] = "http://insecure.example.com"

        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)

        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_candidate_pool_validation(self):
        # Empty candidate pool
        fixture = sample_intersection_grid()
        fixture["candidate_pool"] = []
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # Invalid QID in candidate
        fixture = sample_intersection_grid()
        fixture["candidate_pool"][0]["id"] = "invalid_id"
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_invalid_types_fail(self):
        invalid_cases = [
            ("grid_id", 123456789),
            ("dimensions", [3, 3]),
            ("row_criteria", "not-a-list"),
            ("cells", {"row": 0, "col": 0}),
            ("candidate_pool", "Q21461452"),
        ]
        for field, bad_val in invalid_cases:
            with self.subTest(field=field):
                fixture = sample_intersection_grid()
                fixture[field] = bad_val
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    JSON_VALIDATOR(fixture)
                with self.assertRaises(ValueError):
                    validate_intersection_grid(fixture)

        # Invalid type within a cell
        fixture = sample_intersection_grid()
        fixture["cells"][0]["row_index"] = "0"  # string instead of integer
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            JSON_VALIDATOR(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # Invalid type in valid_entity_ids
        fixture = sample_intersection_grid()
        fixture["cells"][0]["valid_entity_ids"] = [21461452]  # integer instead of string
        with self.assertRaises(fastjsonschema.JsonSchemaException):
            JSON_VALIDATOR(fixture)
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_cell_with_qid_not_in_candidate_pool_fails(self):
        fixture = sample_intersection_grid()
        fixture["cells"][0]["valid_entity_ids"] = ["Q99999999"]
        with self.assertRaises(ValueError) as ctx:
            validate_intersection_grid(fixture)
        self.assertIn("not found in candidate_pool", str(ctx.exception))
        self.assertIn("Q99999999", str(ctx.exception))

    def test_boolean_in_integer_fields_fails(self):
        # dimensions.rows as True
        fixture = sample_intersection_grid()
        fixture["dimensions"]["rows"] = True
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # dimensions.cols as True
        fixture = sample_intersection_grid()
        fixture["dimensions"]["cols"] = True
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # cell.row_index as True
        fixture = sample_intersection_grid()
        fixture["cells"][0]["row_index"] = True
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # cell.col_index as True
        fixture = sample_intersection_grid()
        fixture["cells"][0]["col_index"] = True
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

        # evidence.revision_id as True
        fixture = sample_intersection_grid()
        fixture["cells"][0]["evidence"][0]["revision_id"] = True
        with self.assertRaises(ValueError):
            validate_intersection_grid(fixture)

    def test_atomic_write_and_read(self):
        fixture = sample_intersection_grid()
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "grid.json"
            written = write_intersection_grid_atomic(target, fixture)
            self.assertIsInstance(written, bytes)
            self.assertTrue(target.exists())
            with open(target, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            self.assertEqual(loaded["schema_version"], GRID_SCHEMA_VERSION)
            self.assertEqual(len(loaded["cells"]), 9)
            validate_intersection_grid(loaded)


if __name__ == "__main__":
    unittest.main()
