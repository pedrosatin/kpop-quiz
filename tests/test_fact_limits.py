from __future__ import annotations

import copy
import io
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.cli import report_fact_truncations
from kpop_scraping.evidence import WikipediaPage
from kpop_scraping.fact_limits import (
    MAX_INFOBOX_WIKITEXT_BYTES,
    MAX_MATCHING_NAMES,
    MAX_MEMBERS_PER_GROUP,
    MAX_MEMBERS_PER_RUN,
    FactTruncation,
    cap_has_member_candidates,
    cap_matching_names,
    cap_member_ids,
    cap_pages_wikitext,
    cap_wikitext,
    qid_order,
)
from kpop_scraping.fact_pipeline import extract_facts
from kpop_scraping.facts import group_fact_candidates
from kpop_scraping.storage import Repository

from tests.wikidata_fixture import (
    SUNYE,
    WONDER_GIRLS,
    FixtureWikidataClient,
    build_catalog,
    load_fixture,
)


def _member_claim(qid: str, statement_id: str) -> dict:
    return {
        "id": statement_id,
        "rank": "normal",
        "mainsnak": {
            "snaktype": "value",
            "property": "P527",
            "datavalue": {
                "type": "wikibase-entityid",
                "value": {"entity-type": "item", "numeric-id": int(qid[1:]), "id": qid},
            },
        },
        "references": [],
    }


def _human_entity(qid: str, revid: int, labels: dict | None = None) -> dict:
    return {
        "id": qid,
        "lastrevid": revid,
        "labels": labels or {"en": {"language": "en", "value": qid}},
        "aliases": {},
        "claims": {
            "P31": [
                {
                    "id": f"{qid}$P31",
                    "rank": "normal",
                    "mainsnak": {
                        "snaktype": "value",
                        "property": "P31",
                        "datavalue": {
                            "type": "wikibase-entityid",
                            "value": {
                                "entity-type": "item",
                                "numeric-id": 5,
                                "id": "Q5",
                            },
                        },
                    },
                }
            ]
        },
        "sitelinks": {},
    }


class FactLimitsUnitTest(unittest.TestCase):
    def test_qid_order_matches_numeric_order(self):
        values = ["Q100", "Q2", "Q20", "Q9"]
        self.assertEqual(sorted(values, key=qid_order), ["Q2", "Q9", "Q20", "Q100"])

    def test_cap_has_member_keeps_lowest_qids(self):
        fixture = load_fixture()
        entity = copy.deepcopy(fixture["subject_profile"][WONDER_GIRLS])
        entity["claims"]["P527"] = [
            _member_claim(f"Q{n}", f"{WONDER_GIRLS}$P527${n}") for n in (30, 5, 100, 7, 20)
        ]
        extracted = group_fact_candidates(WONDER_GIRLS, entity)
        capped, cuts = cap_has_member_candidates(extracted.candidates, limit=3)
        member_ids = [
            c.value_id for c in capped if c.predicate == "has_member"
        ]
        self.assertEqual(member_ids, ["Q5", "Q7", "Q20"])
        self.assertEqual(
            cuts,
            (FactTruncation("members_per_group", WONDER_GIRLS, 5, 3),),
        )

    def test_cap_member_ids_per_run(self):
        kept, cut = cap_member_ids(["Q30", "Q2", "Q100", "Q9"], limit=2)
        self.assertEqual(kept, ["Q2", "Q9"])
        self.assertEqual(cut, FactTruncation("members_per_run", "*", 4, 2))

    def test_cap_matching_names(self):
        names = ("aaaaaaaa", "bbbb", "ccc", "dd")
        kept, cut = cap_matching_names(names, "Q1", limit=2)
        self.assertEqual(kept, ("aaaaaaaa", "bbbb"))
        self.assertEqual(cut, FactTruncation("matching_names", "Q1", 4, 2))

    def test_cap_wikitext_skips_oversized(self):
        text = "x" * 50
        kept, cut = cap_wikitext(text, "Q1", limit=10)
        self.assertEqual(kept, "")
        self.assertEqual(cut.kind, "infobox_wikitext")
        self.assertEqual(cut.observed, 50)
        self.assertEqual(cut.kept, 0)

    def test_cap_pages_wikitext_dedupes_shared_revision(self):
        page = WikipediaPage(1, "en", 10, 20, "extract", "Title", "y" * 40, "Q9")
        with patch("kpop_scraping.fact_limits.MAX_INFOBOX_WIKITEXT_BYTES", 10):
            capped, cuts = cap_pages_wikitext({"Q9": page, "alias": page})
        self.assertEqual(len(cuts), 1)
        self.assertEqual(capped["Q9"].wikitext, "")
        self.assertEqual(capped["alias"].wikitext, "")


class FactLimitsPipelineTest(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture()
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def repository(self):
        return Repository(self.root / "test.db", raw_dir=self.root / "raw")

    def _inflate_wonder_girls_members(self, count: int) -> dict:
        fixture = copy.deepcopy(self.fixture)
        group = fixture["subject_profile"][WONDER_GIRLS]
        existing = list(group["claims"].get("P527") or [])
        synthetic = []
        for index in range(count):
            qid = f"Q{900000 + index}"
            synthetic.append(_member_claim(qid, f"{WONDER_GIRLS}$P527$syn{index}"))
            human = _human_entity(qid, 1000 + index)
            fixture["subject_profile"][qid] = human
            fixture["label_profile"][qid] = human
        group["claims"]["P527"] = existing + synthetic
        return fixture

    def test_group_above_member_cap_is_truncated_and_run_completes(self):
        fixture = self._inflate_wonder_girls_members(5)
        with patch("kpop_scraping.fact_pipeline.cap_has_member_candidates") as capped_fn:
            def _cap(candidates, limit=MAX_MEMBERS_PER_GROUP):
                return cap_has_member_candidates(candidates, limit=2)

            capped_fn.side_effect = _cap
            with self.repository() as repository:
                build_catalog(repository, fixture)
                stderr = io.StringIO()
                with redirect_stderr(stderr):
                    totals = extract_facts(repository, FixtureWikidataClient(fixture))
                members = {
                    row[0]
                    for row in repository.connection.execute(
                        """
                        SELECT v.wikidata_id
                        FROM facts f
                        JOIN entities s ON s.id = f.subject_entity_id
                        JOIN entities v ON v.id = f.value_entity_id
                        WHERE f.predicate = 'has_member' AND s.wikidata_id = ?
                          AND f.status != 'superseded'
                        """,
                        (WONDER_GIRLS,),
                    )
                }
                issues = list(
                    repository.connection.execute(
                        """
                        SELECT issue_code, detail FROM fact_issues
                        WHERE issue_code = 'fact_cap_members_per_group'
                        """
                    )
                )
        self.assertGreaterEqual(totals.accepted + totals.rejected, 1)
        self.assertEqual(len(members), 2)
        self.assertTrue(any(t.kind == "members_per_group" for t in totals.truncations))
        self.assertEqual(len(issues), 1)
        self.assertIn("observed=", issues[0][1])

    def test_member_above_name_cap_is_truncated(self):
        fixture = copy.deepcopy(self.fixture)
        person = fixture["subject_profile"][SUNYE]
        person["aliases"] = {
            "en": [{"language": "en", "value": f"Alias {n}"} for n in range(8)],
            "pt": [{"language": "pt", "value": f"Nome {n}"} for n in range(8)],
        }
        with patch("kpop_scraping.fact_pipeline.cap_matching_names") as capped_fn:

            def _cap(names, subject_id, limit=MAX_MATCHING_NAMES):
                return cap_matching_names(names, subject_id, limit=3)

            capped_fn.side_effect = _cap
            with self.repository() as repository:
                build_catalog(repository, fixture)
                totals = extract_facts(repository, FixtureWikidataClient(fixture))
                issues = list(
                    repository.connection.execute(
                        """
                        SELECT wikidata_id, detail FROM fact_issues
                        WHERE issue_code = 'fact_cap_matching_names'
                        """
                    )
                )
        self.assertTrue(any(t.kind == "matching_names" for t in totals.truncations))
        self.assertTrue(issues)
        self.assertEqual(issues[0][0], SUNYE)

    def test_oversized_infobox_wikitext_is_skipped(self):
        from tests.test_fact_pipeline import FixtureWikitextClient, WONDER_GIRLS_WIKITEXT

        fixture = copy.deepcopy(self.fixture)
        page_id = next(
            page["pageid"]
            for page in fixture["wikipedia_pages"]
            if page["wikidata_id"] == WONDER_GIRLS
        )
        for page in fixture["wikipedia_pages"]:
            if page["wikidata_id"] == WONDER_GIRLS:
                page["extract"] = "Wonder Girls was a South Korean girl group."
        huge = WONDER_GIRLS_WIKITEXT + ("padding " * 5000)
        with patch("kpop_scraping.fact_limits.MAX_INFOBOX_WIKITEXT_BYTES", 200):
            with patch("kpop_scraping.fact_pipeline.cap_pages_wikitext", wraps=cap_pages_wikitext):
                with self.repository() as repository:
                    build_catalog(repository, fixture)
                    totals = extract_facts(
                        repository,
                        FixtureWikidataClient(fixture),
                        wikitext_client=FixtureWikitextClient(fixture, {page_id: huge}),
                    )
                    sunye = repository.connection.execute(
                        """
                        SELECT f.status, f.status_reason
                        FROM facts f
                        JOIN entities s ON s.id = f.subject_entity_id
                        JOIN entities v ON v.id = f.value_entity_id
                        WHERE f.predicate = 'has_member'
                          AND s.wikidata_id = ? AND v.wikidata_id = ?
                        """,
                        (WONDER_GIRLS, SUNYE),
                    ).fetchone()
                    issues = list(
                        repository.connection.execute(
                            """
                            SELECT issue_code FROM fact_issues
                            WHERE issue_code = 'fact_cap_infobox_wikitext'
                            """
                        )
                    )
        self.assertTrue(any(t.kind == "infobox_wikitext" for t in totals.truncations))
        self.assertTrue(issues)
        self.assertEqual(tuple(sunye), ("rejected", "missing_evidence"))

    def test_report_fact_truncations_writes_warning(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            report_fact_truncations(
                (
                    FactTruncation("members_per_group", "Q20", 105, 100),
                    FactTruncation("matching_names", "Q5", 120, 100),
                    FactTruncation("infobox_wikitext", "Q9", 2_000_000, 0),
                    FactTruncation("members_per_run", "*", 6000, 5000),
                )
            )
        text = stderr.getvalue()
        self.assertIn("group Q20 has 105 has_member values", text)
        self.assertIn("entity Q5 has 120 evidence names", text)
        self.assertIn("page Q9 has 2000000 bytes of wikitext", text)
        self.assertIn("facts run saw 6000 distinct has_member values", text)


class FactLimitsConstantsTest(unittest.TestCase):
    def test_caps_sit_above_measured_catalog_maxima(self):
        self.assertGreaterEqual(MAX_MEMBERS_PER_GROUP, 26 * 3)
        self.assertGreaterEqual(MAX_MEMBERS_PER_RUN, 1254 * 3)
        self.assertGreaterEqual(MAX_MATCHING_NAMES, 25 * 3)
        self.assertGreaterEqual(MAX_INFOBOX_WIKITEXT_BYTES, 287_103 * 3)


if __name__ == "__main__":
    unittest.main()
