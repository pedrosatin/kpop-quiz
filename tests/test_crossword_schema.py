"""The crossword schema, the Python validator and the web loader stay aligned.

The JSON schema covers structure; validate() adds the domain rules. The
rejection cases live in tests/fixtures/crossword_invalid_cases.json and the
web suite (web/src/data/crossword.test.ts) runs the same list.
"""

import copy
import hashlib
import json
import unittest
from pathlib import Path

try:
    import fastjsonschema
except ImportError:
    fastjsonschema = None

from kpop_scraping import crossword_cli
from kpop_scraping.storage import canonical_json

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "crossword-pilot-v1.json"
PUBLISHED = ROOT / "web" / "public" / "data" / "crossword-pilot.json"
CASES = ROOT / "tests" / "fixtures" / "crossword_invalid_cases.json"


def apply_case(payload: dict, case: dict) -> dict:
    result = copy.deepcopy(payload)
    for op in case["ops"]:
        *parents, last = op["path"]
        target = result
        for key in parents:
            target = target[key]
        if op["op"] == "set":
            target[last] = op["value"]
        elif op["op"] == "append":
            target[last].append(op["value"])
        else:
            raise AssertionError(f"unknown op {op['op']}")
    if case.get("rehash", True):
        content = {k: v for k, v in result.items() if k != "dataset_version"}
        result["dataset_version"] = hashlib.sha256(canonical_json(content)).hexdigest()
    return result


class CrosswordSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        cls.published = json.loads(PUBLISHED.read_text(encoding="utf-8"))
        cls.cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]

    def test_schema_constants_match_the_validator(self):
        props = self.schema["properties"]
        self.assertEqual(self.schema["$id"], "https://kpop-quiz.local/schemas/crossword-pilot-v1.json")
        self.assertEqual(props["schema_version"]["const"], crossword_cli.SCHEMA)
        self.assertEqual(props["mode"]["const"], crossword_cli.MODE)
        self.assertEqual(props["puzzle_id"]["const"], crossword_cli.PUZZLE_ID)
        self.assertEqual(props["rows"]["maximum"], crossword_cli.MAX_SIDE)
        self.assertEqual(props["cols"]["maximum"], crossword_cli.MAX_SIDE)
        self.assertEqual(props["entries"]["minItems"], crossword_cli.MIN_ENTRIES)
        self.assertEqual(props["entries"]["maxItems"], crossword_cli.MAX_ENTRIES)
        defs = self.schema["$defs"]
        self.assertEqual(set(self.schema["required"]), crossword_cli.ROOT_KEYS)
        self.assertEqual(set(defs["entry"]["required"]), crossword_cli.ENTRY_KEYS)
        self.assertEqual(set(defs["source"]["required"]), crossword_cli.SOURCE_KEYS)
        self.assertEqual(set(defs["cell"]["required"]), crossword_cli.CELL_KEYS)

    def test_published_artifact_passes_schema_and_validator(self):
        if fastjsonschema is not None:
            fastjsonschema.compile(self.schema)(copy.deepcopy(self.published))
        crossword_cli.validate(copy.deepcopy(self.published))

    def test_shared_cases_are_rejected(self):
        self.assertGreaterEqual(len(self.cases), 20)
        for case in self.cases:
            with self.subTest(case=case["name"]):
                with self.assertRaises((ValueError, KeyError, TypeError)):
                    crossword_cli.validate(apply_case(self.published, case))

    @unittest.skipIf(fastjsonschema is None, "fastjsonschema not installed")
    def test_schema_rejects_structural_cases(self):
        validator = fastjsonschema.compile(self.schema)
        structural = {
            "missing evidence",
            "clue matching two groups",
            "board too large",
            "blank clue",
            "unknown direction",
            "other puzzle identity",
            "other mode",
            "extra root field",
            "extra source field",
            "extra cell field",
        }
        for case in self.cases:
            if case["name"] not in structural:
                continue
            with self.subTest(case=case["name"]):
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    validator(apply_case(self.published, case))


if __name__ == "__main__":
    unittest.main()
