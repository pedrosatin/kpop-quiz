"""Unit tests for connections puzzle schema v1 and validation."""

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

try:
    import fastjsonschema
except ImportError:
    fastjsonschema = None

from kpop_scraping.connections_schema import (
    CONNECTIONS_SCHEMA_VERSION,
    validate_connections_puzzle,
    write_connections_puzzle_atomic,
)

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "connections-puzzle-v1.json"


def sample_evidence(fact_id: str = "fb-1") -> dict:
    return {
        "fact_base_id": fact_id,
        "locator": "claims/P264/Q21461452$1234/references/hash1",
        "revision_id": 1001,
        "source_key": "wikidata",
        "source_url": "https://www.wikidata.org/wiki/Q21461452",
    }


def sample_connections_puzzle() -> dict:
    """Return a complete, valid sample connections puzzle matching schemas/connections-puzzle-v1.json."""
    categories = [
        {
            "id": "cat_jyp",
            "label": {
                "pt-BR": "Grupos formados pela JYP Entertainment",
                "en": "Groups formed by JYP Entertainment",
            },
            "difficulty_level": 1,
            "item_ids": ["Q21461452", "Q15629342", "Q484432", "Q55616089"],
            "explanation": {
                "pt-BR": "Todos os quatro grupos foram criados e gerenciados pela JYP Entertainment.",
                "en": "All four groups were created and managed by JYP Entertainment.",
            },
            "evidence": [sample_evidence("fb-cat-1")],
        },
        {
            "id": "cat_sm",
            "label": {
                "pt-BR": "Grupos da SM Entertainment",
                "en": "SM Entertainment groups",
            },
            "difficulty_level": 2,
            "item_ids": ["Q494217", "Q17466548", "Q20153", "Q243884"],
            "explanation": {
                "pt-BR": "Todos os quatro grupos foram lançados pela SM Entertainment.",
                "en": "All four groups were debuted by SM Entertainment.",
            },
            "evidence": [sample_evidence("fb-cat-2")],
        },
        {
            "id": "cat_yg",
            "label": {
                "pt-BR": "Grupos da YG Entertainment",
                "en": "YG Entertainment groups",
            },
            "difficulty_level": 3,
            "item_ids": ["Q25056705", "Q14896798", "Q282287", "Q483257"],
            "explanation": {
                "pt-BR": "Todos os quatro grupos foram formados pela YG Entertainment.",
                "en": "All four groups were formed by YG Entertainment.",
            },
            "evidence": [sample_evidence("fb-cat-3")],
        },
        {
            "id": "cat_hybe_labels",
            "label": {
                "pt-BR": "Grupos de subsidiárias da HYBE",
                "en": "HYBE labels groups",
            },
            "difficulty_level": 4,
            "item_ids": ["Q1397102", "Q111531778", "Q111165114", "Q100462445"],
            "explanation": {
                "pt-BR": "Todos os quatro grupos pertencem a selos sob a HYBE.",
                "en": "All four groups belong to labels under HYBE.",
            },
            "evidence": [sample_evidence("fb-cat-4")],
        },
    ]

    items = [
        # Cat 1 (JYP)
        {"id": "Q21461452", "canonical_name": "TWICE", "labels": {"pt-BR": "TWICE", "en": "TWICE"}},
        {"id": "Q15629342", "canonical_name": "GOT7", "labels": {"pt-BR": "GOT7", "en": "GOT7"}},
        {"id": "Q484432", "canonical_name": "Wonder Girls", "labels": {"pt-BR": "Wonder Girls", "en": "Wonder Girls"}},
        {"id": "Q55616089", "canonical_name": "ITZY", "labels": {"pt-BR": "ITZY", "en": "ITZY"}},
        # Cat 2 (SM)
        {"id": "Q494217", "canonical_name": "EXO", "labels": {"pt-BR": "EXO", "en": "EXO"}},
        {"id": "Q17466548", "canonical_name": "Red Velvet", "labels": {"pt-BR": "Red Velvet", "en": "Red Velvet"}},
        {"id": "Q20153", "canonical_name": "Girls' Generation", "labels": {"pt-BR": "Girls' Generation", "en": "Girls' Generation"}},
        {"id": "Q243884", "canonical_name": "SHINee", "labels": {"pt-BR": "SHINee", "en": "SHINee"}},
        # Cat 3 (YG)
        {"id": "Q25056705", "canonical_name": "BLACKPINK", "labels": {"pt-BR": "BLACKPINK", "en": "BLACKPINK"}},
        {"id": "Q14896798", "canonical_name": "WINNER", "labels": {"pt-BR": "WINNER", "en": "WINNER"}},
        {"id": "Q282287", "canonical_name": "BIGBANG", "labels": {"pt-BR": "BIGBANG", "en": "BIGBANG"}},
        {"id": "Q483257", "canonical_name": "2NE1", "labels": {"pt-BR": "2NE1", "en": "2NE1"}},
        # Cat 4 (HYBE)
        {"id": "Q1397102", "canonical_name": "BTS", "labels": {"pt-BR": "BTS", "en": "BTS"}},
        {"id": "Q111531778", "canonical_name": "NewJeans", "labels": {"pt-BR": "NewJeans", "en": "NewJeans"}},
        {"id": "Q111165114", "canonical_name": "LE SSERAFIM", "labels": {"pt-BR": "LE SSERAFIM", "en": "LE SSERAFIM"}},
        {"id": "Q100462445", "canonical_name": "ENHYPEN", "labels": {"pt-BR": "ENHYPEN", "en": "ENHYPEN"}},
    ]

    return {
        "schema_version": CONNECTIONS_SCHEMA_VERSION,
        "puzzle_id": "a" * 64,
        "dataset_version": "b" * 64,
        "reference_date": "2026-09-17",
        "dimensions": {
            "groups": 4,
            "items_per_group": 4,
            "total_items": 16,
        },
        "categories": categories,
        "items": items,
    }


with open(SCHEMA_PATH, "r", encoding="utf-8") as _f:
    SCHEMA_JSON = json.load(_f)

JSON_VALIDATOR = fastjsonschema.compile(SCHEMA_JSON) if fastjsonschema is not None else None


class ConnectionsPuzzleSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SCHEMA_PATH.exists(), f"Schema file not found at {SCHEMA_PATH}"
        cls.schema_json = SCHEMA_JSON
        cls.json_validator = staticmethod(JSON_VALIDATOR) if JSON_VALIDATOR is not None else None

    def test_schema_metadata(self):
        self.assertEqual(
            self.schema_json.get("$schema"),
            "https://json-schema.org/draft/2020-12/schema",
        )
        self.assertEqual(
            self.schema_json.get("$id"),
            "https://kpop-quiz.local/schemas/connections-puzzle-v1.json",
        )
        self.assertFalse(self.schema_json.get("additionalProperties", True))
        required = set(self.schema_json.get("required", []))
        self.assertEqual(
            required,
            {"schema_version", "puzzle_id", "dataset_version", "reference_date", "dimensions", "categories", "items"},
        )

    def test_valid_fixture_passes_schema_and_domain_validator(self):
        fixture = sample_connections_puzzle()
        if self.json_validator is not None:
            validated = self.json_validator(fixture)
            self.assertIsInstance(validated, dict)
        validate_connections_puzzle(fixture)

    def test_invalid_schema_version_fails(self):
        fixture = sample_connections_puzzle()
        fixture["schema_version"] = "kpop-connections-puzzle-v2"

        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)

        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

    def test_invalid_hashes_fail(self):
        for field in ("puzzle_id", "dataset_version"):
            with self.subTest(field=field):
                fixture = sample_connections_puzzle()
                fixture[field] = "not-a-64-char-hex-hash"

                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)

                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

    def test_invalid_reference_date_fails(self):
        for invalid_date in ("2026/09/17", "not-a-date", "2026-02-30"):
            with self.subTest(date=invalid_date):
                fixture = sample_connections_puzzle()
                fixture["reference_date"] = invalid_date

                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

    def test_invalid_dimensions_fail(self):
        # groups != 4
        for bad_groups in (3, 5):
            with self.subTest(bad_groups=bad_groups):
                fixture = sample_connections_puzzle()
                fixture["dimensions"]["groups"] = bad_groups
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

        # items_per_group != 4
        for bad_ipg in (3, 5):
            with self.subTest(bad_ipg=bad_ipg):
                fixture = sample_connections_puzzle()
                fixture["dimensions"]["items_per_group"] = bad_ipg
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

        # total_items != 16
        for bad_total in (15, 17):
            with self.subTest(bad_total=bad_total):
                fixture = sample_connections_puzzle()
                fixture["dimensions"]["total_items"] = bad_total
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

        # missing dimension key
        fixture = sample_connections_puzzle()
        del fixture["dimensions"]["groups"]
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # boolean in dimensions
        for dim_key in ("groups", "items_per_group", "total_items"):
            with self.subTest(dim_key=dim_key):
                fixture = sample_connections_puzzle()
                fixture["dimensions"][dim_key] = True
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

    def test_categories_count_must_be_exactly_four(self):
        # 3 categories
        fixture = sample_connections_puzzle()
        fixture["categories"] = fixture["categories"][:3]
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # 5 categories
        fixture = sample_connections_puzzle()
        extra_cat = deepcopy(fixture["categories"][0])
        extra_cat["id"] = "cat_extra"
        fixture["categories"].append(extra_cat)
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

    def test_category_duplicate_id_fails(self):
        fixture = sample_connections_puzzle()
        fixture["categories"][1]["id"] = fixture["categories"][0]["id"]
        with self.assertRaises(ValueError) as ctx:
            validate_connections_puzzle(fixture)
        self.assertIn("duplicate category id", str(ctx.exception))

    def test_category_invalid_difficulty_fails(self):
        # Difficulty out of range
        for bad_diff in (0, 5, -1):
            with self.subTest(bad_diff=bad_diff):
                fixture = sample_connections_puzzle()
                fixture["categories"][0]["difficulty_level"] = bad_diff
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

        # Duplicate difficulties
        fixture = sample_connections_puzzle()
        fixture["categories"][1]["difficulty_level"] = 1  # now [1, 1, 3, 4]
        with self.assertRaises(ValueError) as ctx:
            validate_connections_puzzle(fixture)
        self.assertIn("distinct difficulty_levels", str(ctx.exception))

        # Boolean difficulty
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["difficulty_level"] = True
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

    def test_category_item_ids_count_must_be_four(self):
        # 3 items in category
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["item_ids"] = fixture["categories"][0]["item_ids"][:3]
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # 5 items in category
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["item_ids"].append("Q99999999")
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Duplicate item in category
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["item_ids"][1] = fixture["categories"][0]["item_ids"][0]
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

    def test_category_overlap_fails(self):
        # Category 0 and Category 1 share an item
        fixture = sample_connections_puzzle()
        shared_item = fixture["categories"][0]["item_ids"][0]
        fixture["categories"][1]["item_ids"][0] = shared_item
        with self.assertRaises(ValueError) as ctx:
            validate_connections_puzzle(fixture)
        self.assertIn("share item(s)", str(ctx.exception))

    def test_category_item_id_not_in_items_pool_fails(self):
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["item_ids"][0] = "Q99999999"
        with self.assertRaises(ValueError) as ctx:
            validate_connections_puzzle(fixture)
        self.assertIn("not found in items pool", str(ctx.exception))
        self.assertIn("Q99999999", str(ctx.exception))

    def test_items_count_must_be_sixteen(self):
        # 15 items
        fixture = sample_connections_puzzle()
        fixture["items"] = fixture["items"][:15]
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # 17 items
        fixture = sample_connections_puzzle()
        extra_item = deepcopy(fixture["items"][0])
        extra_item["id"] = "Q99999999"
        fixture["items"].append(extra_item)
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Duplicate item in items pool
        fixture = sample_connections_puzzle()
        fixture["items"][1]["id"] = fixture["items"][0]["id"]
        with self.assertRaises(ValueError) as ctx:
            validate_connections_puzzle(fixture)
        self.assertIn("duplicate item id", str(ctx.exception))

    def test_category_item_not_in_items_pool_fails(self):
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["item_ids"][0] = "Q9999999"
        with self.assertRaises(ValueError) as ctx:
            validate_connections_puzzle(fixture)
        self.assertIn("category item_ids not found in items pool", str(ctx.exception))

    def test_invalid_qid_format_fails(self):
        for bad_qid in ("P123", "Q0", "12345", "Q_123", ""):
            with self.subTest(bad_qid=bad_qid):
                # in category
                fixture = sample_connections_puzzle()
                fixture["categories"][0]["item_ids"][0] = bad_qid
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

                # in items pool
                fixture = sample_connections_puzzle()
                fixture["items"][0]["id"] = bad_qid
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

    def test_invalid_bilingual_text_fails(self):
        # Missing en in category label
        fixture = sample_connections_puzzle()
        del fixture["categories"][0]["label"]["en"]
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Empty string in category explanation
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["explanation"]["pt-BR"] = ""
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Extra language field
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["label"]["es"] = "Etiqueta"
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Non-dict bilingual text
        fixture = sample_connections_puzzle()
        fixture["items"][0]["labels"] = "TWICE"
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

    def test_invalid_evidence_fails(self):
        # Missing required field in evidence
        fixture = sample_connections_puzzle()
        del fixture["categories"][0]["evidence"][0]["source_url"]
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Insecure source_url
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["evidence"][0]["source_url"] = "http://insecure.example.com"
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # URL with empty netloc
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["evidence"][0]["source_url"] = "https://"
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Revision ID < 1
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["evidence"][0]["revision_id"] = 0
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Boolean in revision_id
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["evidence"][0]["revision_id"] = True
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

        # Empty evidence list
        fixture = sample_connections_puzzle()
        fixture["categories"][0]["evidence"] = []
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError):
            validate_connections_puzzle(fixture)

    def test_missing_and_extra_root_fields_fail(self):
        required_fields = [
            "schema_version",
            "puzzle_id",
            "dataset_version",
            "reference_date",
            "dimensions",
            "categories",
            "items",
        ]
        for field in required_fields:
            with self.subTest(field=field):
                fixture = sample_connections_puzzle()
                del fixture[field]
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError) as ctx:
                    validate_connections_puzzle(fixture)
                self.assertIn("missing or extra fields", str(ctx.exception))

        # Extra root field
        fixture = sample_connections_puzzle()
        fixture["extra_field"] = "not_allowed"
        if self.json_validator is not None:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                self.json_validator(fixture)
        with self.assertRaises(ValueError) as ctx:
            validate_connections_puzzle(fixture)
        self.assertIn("missing or extra fields", str(ctx.exception))

    def test_invalid_types_fail(self):
        invalid_cases = [
            ("puzzle_id", 123456789),
            ("dimensions", [4, 4, 16]),
            ("categories", "not-a-list"),
            ("items", {"Q21461452": "TWICE"}),
        ]
        for field, bad_val in invalid_cases:
            with self.subTest(field=field):
                fixture = sample_connections_puzzle()
                fixture[field] = bad_val
                if self.json_validator is not None:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        self.json_validator(fixture)
                with self.assertRaises(ValueError):
                    validate_connections_puzzle(fixture)

    def test_atomic_write_and_read(self):
        fixture = sample_connections_puzzle()
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "connections.json"
            written = write_connections_puzzle_atomic(target, fixture)
            self.assertIsInstance(written, bytes)
            self.assertTrue(written.endswith(b"\n"))
            self.assertTrue(target.exists())
            with open(target, "rb") as f:
                disk_bytes = f.read()
            self.assertEqual(written, disk_bytes)
            with open(target, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            self.assertEqual(loaded["schema_version"], CONNECTIONS_SCHEMA_VERSION)
            self.assertEqual(len(loaded["categories"]), 4)
            self.assertEqual(len(loaded["items"]), 16)
            validate_connections_puzzle(loaded)


if __name__ == "__main__":
    unittest.main()
