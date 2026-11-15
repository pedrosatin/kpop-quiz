"""Characterize every rejection of crossword_cli.validate, message included.

Each case edits a copy of web/public/data/crossword-pilot.json so that one
rule fails, recomputes dataset_version unless the case breaks dataset_version
itself, and fixes the exact message. validate() raises on the first broken rule,
so the order cases pin which rule wins when a board breaks two of them.
"""

import copy
import hashlib
import json
import subprocess
import sys
import unittest
from datetime import date
from pathlib import Path

from kpop_scraping import crossword_cli
from kpop_scraping.storage import canonical_json

ROOT = Path(__file__).resolve().parents[1]
PUBLISHED = ROOT / "web" / "public" / "data" / "crossword-pilot.json"


def rehash(payload: dict) -> None:
    content = {k: v for k, v in payload.items() if k != "dataset_version"}
    payload["dataset_version"] = hashlib.sha256(canonical_json(content)).hexdigest()


def stdlib_date_message(value: str) -> str:
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        return str(exc)
    raise AssertionError(f"{value} is a valid date")


def set_root(key, value):
    def edit(p):
        p[key] = value
    return edit


def drop_root(key):
    def edit(p):
        del p[key]
    return edit


def set_entry(index, key, value):
    def edit(p):
        p["entries"][index][key] = value
    return edit


def set_clue(index, lang, value):
    def edit(p):
        p["entries"][index]["clue"][lang] = value
    return edit


def set_source(index, key, value):
    def edit(p):
        p["entries"][index]["sources"][0][key] = value
    return edit


def set_cell(index, key, value):
    def edit(p):
        p["cells"][index][key] = value
    return edit


def edits(*changes):
    def edit(p):
        for change in changes:
            change(p)
    return edit


def duplicate_first_entry(p):
    p["entries"].append(copy.deepcopy(p["entries"][0]))


def repeat_first_qid(p):
    p["entries"][1]["qid"] = p["entries"][0]["qid"]


def mismatched_url(p):
    source = p["entries"][0]["sources"][0]
    source["url"] = source["url"].replace("oldid=", "oldid=9")


def reversed_span(p):
    source = p["entries"][0]["sources"][0]
    source["locator"] = source["locator"].split("#")[0] + "#wikitext[9:3]"


def same_direction_overlap(p):
    entry = p["entries"][2]
    entry["direction"] = "across"
    entry["row"] = 0
    entry["col"] = 2


def detached_last_entry(p):
    p["rows"] = 7
    p["entries"][2]["row"] = 1


def orphan_cell(p):
    p["cells"].append({"row": 5, "col": 0, "answer": "A"})


def missing_cell(p):
    p["cells"].pop()


# (case name, edit, recompute checksum, exact message)
REJECTIONS = [
    ("not an object", None, False, "unsupported crossword"),
    ("other schema version", set_root("schema_version", "crossword-pilot-v2"), True, "unsupported crossword"),
    ("other mode", set_root("mode", "daily"), True, "unsupported crossword"),
    ("extra root field", set_root("extra", True), True, "unexpected fields"),
    ("missing root field", drop_root("vocabulary"), True, "unexpected fields"),
    ("other puzzle identity", set_root("puzzle_id", "crossword-audited-02"), True, "missing identity"),
    ("uppercase dataset version", set_root("dataset_version", "A" * 64), False, "missing identity"),
    ("dataset version with a suffix", lambda p: p.update(dataset_version=p["dataset_version"] + "x"), False, "missing identity"),
    ("dataset version not a string", set_root("dataset_version", 1), False, "missing identity"),
    ("reference date with slashes", set_root("reference_date", "2026/10/12"), True, "missing reference date"),
    ("reference date with a suffix", set_root("reference_date", "2026-10-12x"), True, "missing reference date"),
    ("reference date not a string", set_root("reference_date", 20261012), True, "missing reference date"),
    ("impossible reference date", set_root("reference_date", "2026-02-31"), True, stdlib_date_message("2026-02-31")),
    ("checksum mismatch", set_root("dataset_version", "0" * 64), False, "dataset checksum mismatch"),
    ("too many rows", set_root("rows", 10), True, "board bounds"),
    ("no columns", set_root("cols", 0), True, "board bounds"),
    ("boolean rows", set_root("rows", True), True, "board bounds"),
    ("entries not a list", set_root("entries", {}), True, "entry count"),
    ("too few entries", lambda p: p["entries"].pop(), True, "entry count"),
    ("too many entries", edits(duplicate_first_entry, duplicate_first_entry, duplicate_first_entry), True, "entry count"),
    ("audited count below the entries", set_root("audited_group_count", 2), True, "audited group count"),
    ("boolean audited count", set_root("audited_group_count", True), True, "audited group count"),
    ("cells not a list", set_root("cells", {}), True, "unexpected fields"),
    ("extra cell field", set_cell(0, "extra", 1), True, "unexpected fields"),
    ("cell row not an integer", set_cell(0, "row", "0"), True, "cell types"),
    ("cell answer not a string", set_cell(0, "answer", 1), True, "cell types"),
    ("vocabulary not a list", set_root("vocabulary", "Q1"), True, "vocabulary mismatch"),
    ("extra entry field", set_entry(0, "extra", "x"), True, "unexpected fields"),
    ("clue not an object", set_entry(0, "clue", "BTS"), True, "unexpected fields"),
    ("extra clue language", set_clue(0, "es", "x"), True, "unexpected fields"),
    ("aliases not a list", set_entry(0, "aliases", "BTS"), True, "unexpected fields"),
    ("sources not a list", set_entry(0, "sources", {}), True, "unexpected fields"),
    ("matching qids not a list", set_entry(0, "matching_qids", "Q13580495"), True, "unexpected fields"),
    ("malformed qid", set_entry(0, "qid", "Q0"), True, "identity"),
    ("qid with a suffix", set_entry(0, "qid", "Q1x"), True, "identity"),
    ("qid not a string", set_entry(0, "qid", 13580495), True, "identity"),
    ("repeated qid", repeat_first_qid, True, "identity"),
    ("canonical name not a string", set_entry(0, "canonical_name", 1), True, "normalization"),
    ("answer not a string", set_entry(0, "answer", 1), True, "normalization"),
    ("alias not a string", set_entry(0, "aliases", ["BTS", 1]), True, "normalization"),
    ("answer not normalized from the name", set_entry(0, "canonical_name", "BTX"), True, "normalization"),
    ("name without letters or digits", edits(set_entry(0, "canonical_name", "!!!"), set_entry(0, "answer", "")), True, "normalization"),
    ("unknown direction", set_entry(0, "direction", "diagonal"), True, "direction"),
    ("row not an integer", set_entry(0, "row", "0"), True, "coordinates"),
    ("boolean column", set_entry(0, "col", False), True, "coordinates"),
    ("boolean entry number", set_entry(0, "number", True), True, "coordinates"),
    ("alias shared by two groups", lambda p: p["entries"][1]["aliases"].append("BTS"), True, "ambiguous alias"),
    ("blank clue", set_clue(0, "en", "  "), True, "missing clue"),
    ("clue text not a string", set_clue(0, "pt-BR", 1), True, "missing clue"),
    ("missing evidence", set_entry(0, "sources", []), True, "missing evidence"),
    ("source not an object", set_entry(0, "sources", ["x"]), True, "invalid evidence"),
    ("extra source field", set_source(0, "extra", "x"), True, "invalid evidence"),
    ("empty snippet", set_source(0, "snippet", ""), True, "invalid evidence"),
    ("url not a string", set_source(0, "url", 1), True, "invalid evidence"),
    ("url revision differs from locator", mismatched_url, True, "invalid evidence"),
    ("reversed evidence span", reversed_span, True, "invalid evidence"),
    ("statement of another item", set_source(0, "statement_id", "Q1$x"), True, "invalid evidence"),
    ("entry outside board", set_root("cols", 2), True, "entry outside board"),
    ("incompatible crossing", edits(set_entry(1, "canonical_name", "ATOB"), set_entry(1, "answer", "ATOB")), True, "invalid crossing"),
    ("same direction overlap", same_direction_overlap, True, "invalid crossing"),
    ("wrong numbering", set_entry(2, "number", 3), True, "numbering"),
    ("disconnected entries", detached_last_entry, True, "disconnected entries"),
    ("vocabulary mismatch", set_root("vocabulary", []), True, "vocabulary mismatch"),
    ("clue matching two groups", lambda p: p["entries"][0]["matching_qids"].append("Q123"), True, "ambiguous clue"),
    ("clue matching another group", set_entry(0, "matching_qids", ["Q491067"]), True, "ambiguous clue"),
    ("orphan cell", orphan_cell, True, "orphan or missing cells"),
    ("missing cell", missing_cell, True, "orphan or missing cells"),
]

# Boards that break two rules: validate() stops at the first rule it checks.
# Entries are checked one at a time, all rules of an entry before the next.
# (case name, edit, recompute checksum, exact message)
# One case per pair of rules that run one after the other, in validate() and in
# the checks of each entry, plus the order between entries.
FIRST_RULE_WINS = [
    ("schema before root fields", edits(set_root("mode", "daily"), set_root("extra", True)), True, "unsupported crossword"),
    ("root fields before identity", edits(set_root("extra", True), set_root("puzzle_id", "x")), True, "unexpected fields"),
    ("identity before reference date", edits(set_root("puzzle_id", "x"), set_root("reference_date", "x")), True, "missing identity"),
    ("reference date format before checksum", set_root("reference_date", "2026/10/12"), False, "missing reference date"),
    ("impossible date before checksum", set_root("reference_date", "2026-02-31"), False, stdlib_date_message("2026-02-31")),
    ("checksum before board bounds", set_root("rows", 10), False, "dataset checksum mismatch"),
    ("board bounds before entry count", edits(set_root("rows", 10), lambda p: p["entries"].pop()), True, "board bounds"),
    ("entry count before audited count", edits(lambda p: p["entries"].pop(), set_root("audited_group_count", 1)), True, "entry count"),
    ("audited count before cell shapes", edits(set_root("audited_group_count", 2), set_cell(0, "extra", 1)), True, "audited group count"),
    ("cell fields before cell types", edits(set_cell(0, "extra", 1), set_cell(1, "row", "0")), True, "unexpected fields"),
    ("cell types before vocabulary type", edits(set_cell(0, "row", "0"), set_root("vocabulary", "Q1")), True, "cell types"),
    ("vocabulary type before entries", edits(set_root("vocabulary", "Q1"), set_entry(0, "extra", "x")), True, "vocabulary mismatch"),
    ("board bounds before vocabulary", edits(set_root("rows", 10), set_root("vocabulary", [])), True, "board bounds"),
    ("entry fields before identity", edits(set_entry(0, "extra", "x"), set_entry(0, "qid", "Q0")), True, "unexpected fields"),
    ("identity before normalization", edits(set_entry(0, "qid", "Q0"), set_entry(0, "canonical_name", "BTX")), True, "identity"),
    ("normalization before direction", edits(set_entry(0, "canonical_name", "BTX"), set_entry(0, "direction", "diagonal")), True, "normalization"),
    ("direction before coordinates", edits(set_entry(0, "direction", "diagonal"), set_entry(0, "row", "0")), True, "direction"),
    ("coordinates before aliases", edits(set_entry(1, "row", "0"), lambda p: p["entries"][1]["aliases"].append("BTS")), True, "coordinates"),
    ("aliases before clue", edits(lambda p: p["entries"][1]["aliases"].append("BTS"), set_clue(1, "en", " ")), True, "ambiguous alias"),
    ("clue before evidence in one entry", edits(set_clue(0, "en", " "), set_entry(0, "sources", [])), True, "missing clue"),
    ("evidence before crossing", edits(set_entry(1, "sources", []), set_entry(1, "canonical_name", "ATOB"), set_entry(1, "answer", "ATOB")), True, "missing evidence"),
    ("earlier entry first: clue then direction", edits(set_clue(1, "en", " "), set_entry(2, "direction", "x")), True, "missing clue"),
    ("earlier entry first: direction then clue", edits(set_entry(1, "direction", "x"), set_clue(2, "en", " ")), True, "direction"),
    ("crossing before numbering", edits(set_entry(1, "canonical_name", "ATOB"), set_entry(1, "answer", "ATOB"), set_entry(2, "number", 3)), True, "invalid crossing"),
    ("numbering before connection", edits(detached_last_entry, set_entry(2, "number", 3)), True, "numbering"),
    ("connection before vocabulary", edits(detached_last_entry, set_root("vocabulary", [])), True, "disconnected entries"),
    ("vocabulary before ambiguous clue", edits(set_root("vocabulary", []), set_entry(0, "matching_qids", [])), True, "vocabulary mismatch"),
    ("ambiguous clue before cells", edits(set_entry(0, "matching_qids", []), orphan_cell), True, "ambiguous clue"),
    ("numbering before cells", edits(set_entry(2, "number", 3), orphan_cell), True, "numbering"),
]


class CrosswordCliRejectionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.published = json.loads(PUBLISHED.read_text(encoding="utf-8"))

    def board(self, edit, recompute=True):
        p = copy.deepcopy(self.published)
        edit(p)
        if recompute:
            rehash(p)
        return p

    def assert_rejected(self, payload, message):
        with self.assertRaises(ValueError) as ctx:
            crossword_cli.validate(payload)
        self.assertIs(type(ctx.exception), ValueError)
        self.assertEqual(str(ctx.exception), message)

    def test_published_board_is_accepted(self):
        crossword_cli.validate(copy.deepcopy(self.published))

    def test_each_rule_rejects_with_its_message(self):
        for name, edit, recompute, message in REJECTIONS:
            with self.subTest(case=name):
                payload = [] if edit is None else self.board(edit, recompute)
                self.assert_rejected(payload, message)

    def test_first_broken_rule_wins(self):
        for name, edit, recompute, message in FIRST_RULE_WINS:
            with self.subTest(case=name):
                self.assert_rejected(self.board(edit, recompute), message)

    def test_cli_prints_the_first_rejection(self):
        payload = self.board(edits(set_root("rows", 10), set_root("vocabulary", [])))
        result = subprocess.run(
            [sys.executable, "-m", "kpop_scraping.crossword_cli", "--verify", "/dev/stdin"],
            cwd=ROOT,
            input=json.dumps(payload),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "crossword pilot rejected: board bounds\n")


if __name__ == "__main__":
    unittest.main()
