import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from kpop_scraping.fact_pipeline import extract_facts
from kpop_scraping.mediawiki import Page
from kpop_scraping.quiz_repository import _dataset_version, _load_entities, _load_facts
from kpop_scraping.storage import Repository

from tests.wikidata_fixture import (
    NAYEON,
    RED_VELVET,
    SUNMI,
    SUNYE,
    TWICE,
    WENDY,
    YERI,
    FixtureWikidataClient,
    build_catalog,
    load_fixture,
)

TZUYU = "Q20688219"
REFERENCE_DATE = date(2026, 10, 29)


def infobox(**fields):
    body = "\n".join(f"| {name} = {value}" for name, value in fields.items())
    return "{{Infobox person\n| name = Someone\n" + body + "\n}}\n'''Someone''' is a singer."


# Wikipedia titles come from the enwiki sitelinks of the Wikidata fixture.
PAGES = {
    "Nayeon": dict(pageid=9001, revid=91001, qid=NAYEON, wikitext=infobox(birth_place="[[Seoul]], South Korea")),
    "Wendy (singer)": dict(
        pageid=9002, revid=91002, qid=WENDY,
        wikitext=infobox(
            birth_date="{{birth date and age|1994|2|21}}",
            birth_place="[[Seongbuk District]], [[Seoul]]",
        ),
    ),
    "Yeri (singer)": dict(
        pageid=9003, revid=91003, qid=YERI,
        wikitext=infobox(birth_date="{{Birth date and age|1999|3|5}}<ref>x</ref>"),
    ),
    "Sunye": dict(pageid=9004, revid=91004, qid=SUNYE, wikitext=infobox(birth_date="{{birth date and age|1989|8|13}}")),
    # The title of Sunmi redirects to a group page.
    "Sunmi": dict(
        pageid=9005, revid=91005, qid="Q999000", is_redirect=True, title="Wonder Girls",
        wikitext="{{Infobox musical artist\n| origin = [[Seoul]]\n}}",
    ),
    # Tzuyu's wikitext is hidden.
    "Tzuyu": dict(pageid=9006, revid=91006, qid=TZUYU, wikitext=None),
}


class FixturePersonClient:
    """Serve person pages by title and their wikitext by revision, recording each request."""

    language = "en"

    def __init__(self, pages=PAGES):
        self.pages = pages
        self.title_calls = []
        self.revision_calls = []

    def resolve_titles(self, titles):
        self.title_calls.append(tuple(titles))
        result = {}
        for title in titles:
            spec = self.pages.get(title)
            if spec is None:
                continue
            result[title] = Page(
                page_id=spec["pageid"],
                title=spec.get("title", title),
                canonical_url=f"https://en.wikipedia.org/wiki/{title}",
                extract="Intro that never proves a person fact.",
                revision_id=spec["revid"],
                wikidata_id=spec["qid"],
                is_redirect=spec.get("is_redirect", False),
            )
        return result

    def get_revision_wikitext(self, revision_ids):
        self.revision_calls.append(tuple(revision_ids))
        by_revision = {spec["revid"]: spec for spec in self.pages.values()}
        return {
            revid: {
                "pageid": by_revision[revid]["pageid"],
                "revid": revid,
                "contentmodel": "wikitext",
                "wikitext": by_revision[revid]["wikitext"],
            }
            for revid in revision_ids
            if by_revision[revid]["wikitext"] is not None
        }


def scalar(repository, query, parameters=()):
    return repository.connection.execute(query, parameters).fetchone()[0]


class PersonPagesPipelineTest(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture()
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def repository(self):
        return Repository(self.root / "test.db", raw_dir=self.root / "raw")

    def facts(self, repository):
        rows = repository.connection.execute(
            """
            SELECT e.wikidata_id, f.predicate, f.status, f.status_reason,
                   f.quality_flags_json, fe.locator, fe.snippet
            FROM facts f
            JOIN entities e ON e.id = f.subject_entity_id
            LEFT JOIN fact_evidence fe ON fe.fact_id = f.id
            WHERE f.predicate IN ('born_on', 'born_in')
            """
        ).fetchall()
        return {
            (row["wikidata_id"], row["predicate"]): (
                row["status"], row["status_reason"], tuple(json.loads(row["quality_flags_json"])),
                row["locator"], row["snippet"],
            )
            for row in rows
        }

    def run_pipeline(self, repository, client=None):
        return extract_facts(repository, FixtureWikidataClient(self.fixture), person_client=client)

    def test_without_a_person_client_nothing_is_collected_and_no_birth_fact_is_accepted(self):
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            self.run_pipeline(repository)
            facts = self.facts(repository)
            self.assertEqual(scalar(repository, "SELECT COUNT(*) FROM person_source_pages"), 0)
            self.assertEqual(scalar(repository, "SELECT COUNT(*) FROM collection_runs WHERE category=?", ("person-wikipedia-evidence",)), 0)
        self.assertNotIn("accepted", {value[0] for value in facts.values()})

    def test_collection_to_fact_to_consumption(self):
        client = FixturePersonClient()
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            self.run_pipeline(repository)
            before = _dataset_version(
                repository.connection, _load_entities(repository.connection), REFERENCE_DATE
            )
            self.run_pipeline(repository, client)
            facts = self.facts(repository)

            # Collection: one sequential title request, wikitext only for pages that qualify.
            self.assertEqual(len(client.title_calls), 1)
            self.assertEqual(
                sorted(client.title_calls[0]),
                sorted(PAGES),
            )
            self.assertEqual(
                sorted(client.revision_calls[0]),
                sorted(spec["revid"] for title, spec in PAGES.items() if title != "Sunmi"),
            )
            states = {
                row["wikidata_id"]: (row["state"], row["reason"], row["page_wikidata_id"])
                for row in repository.connection.execute(
                    """
                    SELECT e.wikidata_id, p.state, p.reason, p.page_wikidata_id
                    FROM person_source_pages p JOIN entities e ON e.id = p.person_entity_id
                    """
                )
            }
            self.assertEqual(states[NAYEON], ("accepted", None, NAYEON))
            self.assertEqual(states[SUNMI], ("rejected", "page_redirect", "Q999000"))
            self.assertEqual(states[TZUYU], ("rejected", "wikitext_unavailable", TZUYU))
            run = repository.connection.execute(
                "SELECT status, pages_collected FROM collection_runs WHERE category='person-wikipedia-evidence'"
            ).fetchone()
            self.assertEqual(tuple(run), ("completed", 4))
            # Five revisions were asked for; Tzuyu's text is hidden, so four were stored.
            self.assertEqual(len(client.revision_calls[0]), 5)
            self.assertEqual(
                scalar(repository, "SELECT COUNT(*) FROM source_revision_wikitext"), 4
            )

            # Fact: the infobox decides; a divergence is rejected and a redirect is ignored.
            # Nayeon is not an accepted member, so her facts stay retired as before.
            self.assertEqual(facts[(NAYEON, "born_in")][:2], ("stale", "subject_not_listed_by_group"))
            self.assertEqual(facts[(YERI, "born_on")][:3], ("accepted", None, ()))
            self.assertEqual(facts[(WENDY, "born_on")][:3], ("accepted", None, ()))
            self.assertEqual(facts[(WENDY, "born_in")][:3], ("accepted", None, ()))
            self.assertEqual(facts[(SUNYE, "born_on")][:2], ("rejected", "wikipedia_value_differs"))
            self.assertEqual(facts[(SUNMI, "born_on")][:2], ("rejected", "missing_evidence"))
            self.assertEqual(facts[(TZUYU, "born_in")][:2], ("rejected", "missing_evidence"))
            locator, snippet = facts[(YERI, "born_on")][3:]
            wikitext = PAGES["Yeri (singer)"]["wikitext"]
            start = wikitext.index("{{Birth date")
            end = wikitext.index("}}", start) + 2
            self.assertEqual(locator, f"wikipedia:en:pageid=9003:revid=91003#wikitext[{start}:{end}]")
            self.assertEqual(snippet, "birth_date = {{Birth date and age|1999|3|5}}")
            self.assertEqual(
                facts[(WENDY, "born_in")][4], "birth_place = [[Seongbuk District]]"
            )

            # What the page said stays reviewable next to the rejected fact.
            issue = repository.connection.execute(
                "SELECT issue_code, detail FROM fact_issues WHERE wikidata_id=? AND issue_code=?",
                (SUNYE, "wikipedia_value_differs"),
            ).fetchone()
            self.assertIn("birth_date = {{birth date and age|1989|8|13}}", issue["detail"])
            self.assertIn("pageid=9004:revid=91004#wikitext[", issue["detail"])
            self.assertIn(
                "Q483642$0BEFA92E-1CFA-4801-B293-A5677333F270", issue["detail"]
            )

            # Consumption: the loader hands the quiz stage the person revision as source.
            entities = _load_entities(repository.connection)
            accepted, rejected = _load_facts(repository.connection, entities)
            by_key = {(fact.subject.wikidata_id, fact.predicate): fact for fact in accepted}
            yeri = by_key[(YERI, "born_on")]
            self.assertEqual(yeri.value_time, "1999-03-05")
            self.assertEqual(
                (yeri.evidence[0].source_key, yeri.evidence[0].revision_id, yeri.evidence[0].source_url),
                ("wikipedia:en", 91003, "https://en.wikipedia.org/w/index.php?curid=9003&oldid=91003"),
            )
            self.assertNotIn((SUNYE, "born_on"), by_key)
            self.assertEqual(rejected["fact_rejected__wikipedia_value_differs"], 1)
            # born_in is not a quiz predicate yet, so the loader leaves it out.
            self.assertNotIn((WENDY, "born_in"), by_key)

            # Artifact: the dataset version moves with the new evidence.
            after = _dataset_version(repository.connection, entities, REFERENCE_DATE)
            self.assertNotEqual(before, after)

    def test_second_run_asks_for_titles_again_but_downloads_no_wikitext_twice(self):
        client = FixturePersonClient()
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            self.run_pipeline(repository, client)
            counts = [
                scalar(repository, f"SELECT COUNT(*) FROM {table}")
                for table in ("facts", "fact_evidence", "source_revisions", "source_revision_wikitext", "person_source_pages")
            ]
            first = self.facts(repository)
            self.run_pipeline(repository, client)
            again = [
                scalar(repository, f"SELECT COUNT(*) FROM {table}")
                for table in ("facts", "fact_evidence", "source_revisions", "source_revision_wikitext", "person_source_pages")
            ]
            self.assertEqual(self.facts(repository), first)
        self.assertEqual(counts, again)
        self.assertEqual(len(client.title_calls), 2)
        # Tzuyu's wikitext is hidden, so only that revision is asked for again.
        self.assertEqual(client.revision_calls[1], (91006,))

    def test_a_new_revision_is_a_new_snapshot_and_the_old_one_stays(self):
        client = FixturePersonClient()
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            self.run_pipeline(repository, client)
            edited = {title: dict(spec) for title, spec in PAGES.items()}
            edited["Sunye"].update(
                revid=91104, wikitext=infobox(birth_date="{{birth date and age|1989|8|12}}")
            )
            self.run_pipeline(repository, FixturePersonClient(edited))
            fact = self.facts(repository)[(SUNYE, "born_on")]
            revisions = sorted(
                row[0]
                for row in repository.connection.execute(
                    "SELECT external_revision_id FROM source_revisions WHERE external_revision_id IN (91004, 91104)"
                )
            )
            current = scalar(
                repository,
                """
                SELECT sr.external_revision_id FROM person_source_pages p
                JOIN entities e ON e.id = p.person_entity_id
                JOIN source_revisions sr ON sr.id = p.source_revision_id
                WHERE e.wikidata_id = ?
                """,
                (SUNYE,),
            )
        self.assertEqual(fact[:2], ("accepted", None))
        self.assertIn("revid=91104#wikitext[", fact[3])
        self.assertEqual(revisions, [91004, 91104])
        self.assertEqual(current, 91104)

    def test_only_people_without_a_reliable_reference_are_requested(self):
        client = FixturePersonClient()
        fixture = json.loads(json.dumps(self.fixture))
        # Give Yeri's birth date a reliable source: her page is no longer needed.
        reference = {
            "hash": "reliable",
            "snaks": {"P854": [{"snaktype": "value", "datavalue": {"type": "string", "value": "https://www.jype.com/artist/yeri"}}]},
        }
        fixture["subject_profile"][YERI]["claims"]["P569"][0]["references"] = [reference]
        with self.repository() as repository:
            build_catalog(repository, fixture)
            extract_facts(repository, FixtureWikidataClient(fixture), person_client=client)
            requested = set(client.title_calls[0])
            status = self.facts(repository)[(YERI, "born_on")][:2]
        self.assertNotIn("Yeri (singer)", requested)
        self.assertEqual(status, ("accepted", None))

    def test_wrong_identity_pages_are_refused_at_collection(self):
        pages = {title: dict(spec) for title, spec in PAGES.items()}
        pages["Wendy (singer)"]["qid"] = "Q1"
        pages["Yeri (singer)"]["is_redirect"] = True
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            self.run_pipeline(repository, FixturePersonClient(pages))
            reasons = {
                row["wikidata_id"]: row["reason"]
                for row in repository.connection.execute(
                    "SELECT e.wikidata_id, p.reason FROM person_source_pages p JOIN entities e ON e.id=p.person_entity_id"
                )
            }
            facts = self.facts(repository)
        self.assertEqual(reasons[WENDY], "page_wikidata_mismatch")
        self.assertEqual(reasons[YERI], "page_redirect")
        self.assertEqual(facts[(WENDY, "born_in")][:2], ("rejected", "missing_evidence"))
        self.assertEqual(facts[(WENDY, "born_on")][:2], ("rejected", "unreliable_reference_source"))
        self.assertEqual(facts[(YERI, "born_on")][:2], ("rejected", "missing_evidence"))

    def test_failed_run_rolls_back_person_pages_too(self):
        class Failing(FixturePersonClient):
            def get_revision_wikitext(self, revision_ids):
                raise RuntimeError("wikitext unavailable")

        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            with self.assertRaisesRegex(RuntimeError, "wikitext unavailable"):
                self.run_pipeline(repository, Failing())
            rows = scalar(repository, "SELECT COUNT(*) FROM person_source_pages")
            runs = scalar(repository, "SELECT COUNT(*) FROM collection_runs WHERE category='person-wikipedia-evidence'")
            failed = scalar(repository, "SELECT COUNT(*) FROM fact_runs WHERE status='failed'")
        self.assertEqual((rows, runs, failed), (0, 0, 1))


if __name__ == "__main__":
    unittest.main()
