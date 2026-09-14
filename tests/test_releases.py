import json
import sqlite3
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from kpop_scraping.mediawiki import MediaWikiError
from kpop_scraping.release_discovery import WikidataQueryClient, _parse_results, build_query
from kpop_scraping.release_facts import release_entity_type, release_fact_candidates
from kpop_scraping.release_pipeline import _performer_entity_ids
from kpop_scraping.storage import MIGRATIONS, apply_migrations
from kpop_scraping.quiz_models import Entity, Evidence, Fact
from kpop_scraping.release_quiz_drafts import build_release_drafts


def item_statement(statement_id, property_id, value, qualifiers=None):
    return {
        "id": statement_id, "rank": "normal", "type": "statement",
        "mainsnak": {"property": property_id, "snaktype": "value", "datatype": "wikibase-item", "datavalue": {"type": "wikibase-entityid", "value": {"id": value}}},
        "qualifiers": qualifiers or {}, "references": [],
    }


def time_statement(qualifiers=None):
    return {
        "id": "release$date", "rank": "normal", "type": "statement",
        "mainsnak": {"property": "P577", "snaktype": "value", "datatype": "time", "datavalue": {"type": "time", "value": {"time": "+2020-01-02T00:00:00Z", "precision": 11, "calendarmodel": "http://www.wikidata.org/entity/Q1985727"}}},
        "qualifiers": qualifiers or {}, "references": [],
    }


class ReleaseFactTest(unittest.TestCase):
    def test_classifies_only_explicit_release_classes(self):
        album = {"claims": {"P31": [item_statement("i", "P31", "Q482994")]}}
        generic = {"claims": {"P31": [item_statement("i", "P31", "Q2031291")]}}
        self.assertEqual(release_entity_type(album), "album")
        self.assertIsNone(release_entity_type(generic))

    def test_scoped_publication_date_is_not_publishable(self):
        entity = {"claims": {"P577": [time_statement({"P291": [{"snaktype": "value"}]})]}}
        candidate = release_fact_candidates("Q100", entity).candidates[0]
        self.assertEqual(candidate.error, "scoped_release_date")

    def test_performer_redirect_matches_the_resolved_catalog_entity(self):
        entity = {"claims": {"P175": [item_statement("p", "P175", "Q10")]}}
        extracted = release_fact_candidates("Q100", entity)
        self.assertEqual(_performer_entity_ids(extracted, {"Q10": 7, "Q20": 7}), {7})

    def test_discovery_is_sorted_deduplicated_and_bounded(self):
        query = build_query(["Q2", "Q1"])
        self.assertLess(query.index("wd:Q1"), query.index("wd:Q2"))
        payload = {"results": {"bindings": [
            {"performer": {"value": "http://www.wikidata.org/entity/Q1"}, "release": {"value": "http://www.wikidata.org/entity/Q9"}},
            {"performer": {"value": "http://www.wikidata.org/entity/Q1"}, "release": {"value": "http://www.wikidata.org/entity/Q9"}},
        ]}}
        self.assertEqual(len(_parse_results(json.dumps(payload).encode(), {"Q1"}, 1)), 1)

    def test_wdqs_retries_server_errors_and_limits_response_size(self):
        payload = json.dumps({"results": {"bindings": []}}).encode()

        class Response:
            def __init__(self, body):
                self.body = body
                self.status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, limit):
                return self.body[:limit]

        attempts = []

        def opener(*_args, **_kwargs):
            attempts.append(None)
            if len(attempts) == 1:
                raise HTTPError("https://query.wikidata.org", 503, "busy", Message(), None)
            return Response(payload)

        with patch("kpop_scraping.release_discovery.time.sleep"):
            result = WikidataQueryClient(opener=opener, retries=1).query("SELECT * WHERE {}")
        self.assertEqual(json.loads(result.body), {"results": {"bindings": []}})
        self.assertEqual(result.http_status, 200)
        self.assertEqual(len(attempts), 2)

        client = WikidataQueryClient(opener=lambda *_args, **_kwargs: Response(payload), max_response_bytes=4)
        with self.assertRaisesRegex(MediaWikiError, "size limit"):
            client.query("SELECT * WHERE {}")

    def test_rejects_invalid_per_group_limit(self):
        with self.assertRaisesRegex(ValueError, "candidate limit"):
            from kpop_scraping.release_discovery import discover_releases
            discover_releases(None, None, max_per_group=0)

    def test_quizzes_include_scope_facts_and_exclude_other_correct_answers(self):
        groups = [Entity(f"QG{i}", "group", f"Group {i}", {}) for i in range(4)]
        releases = [Entity(f"QR{i}", "album", f"Album {i}", {}) for i in range(4)]
        facts = []
        for index, (group, release) in enumerate(zip(groups, releases)):
            performer_id = f"performer-{index}"
            date_id = f"date-{index}"
            facts.extend([
                Fact(performer_id, release, "performed_by", group, None, None, None, None, None, None, (), (Evidence(performer_id, "domain:example.com", "P175", "https://example.com", 1),)),
                Fact(date_id, release, "released_on", None, f"20{index:02d}-01-01", 11, None, None, None, None, (), (Evidence(date_id, "domain:example.com", "P577", "https://example.com", 1),)),
            ])
        drafts, _ = build_release_drafts(facts)
        self.assertEqual({draft.question_type for draft in drafts}, {"release_for_group", "group_for_release", "release_year", "earliest_release"})
        for draft in drafts:
            if draft.question_type in {"release_year", "earliest_release"}:
                self.assertTrue(any(value.startswith("performer-") for value in draft.fact_base_ids))
        earliest = [draft for draft in drafts if draft.question_type == "earliest_release"]
        self.assertEqual(len(earliest), 1)


class ReleaseMigrationTest(unittest.TestCase):
    def test_v5_rows_ids_and_foreign_keys_survive_release_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = sqlite3.connect(Path(directory) / "v5.db")
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            apply_migrations(connection, MIGRATIONS[:5])
            connection.execute("INSERT INTO collection_runs(id,category,started_at,status) VALUES (1,'x','x','completed')")
            connection.execute("INSERT INTO source_pages(id,provider,language,external_page_id,title,canonical_url,extract,fetched_at,last_run_id) VALUES (1,'wikipedia','en',1,'g','u','', 'x',1)")
            connection.execute("INSERT INTO source_revisions(id,source_page_id,external_revision_id,snapshot_path,content_sha256,fetched_at) VALUES (1,1,1,'x',?, 'x')", ("0"*64,))
            connection.execute("INSERT INTO catalog_runs(id,classifier_version,started_at,status) VALUES (1,'v','x','completed')")
            connection.execute("INSERT INTO catalog_entries(source_page_id,source_revision_id,analyzed_wikidata_id,state,classifier_version,classified_at) VALUES (1,1,'Q1','accepted','v','x')")
            connection.execute("INSERT INTO fact_runs(id,extractor_version,source_policy_version,started_at,status) VALUES (1,'v','v','x','completed')")
            connection.execute("INSERT INTO wikidata_entity_snapshots(id,wikidata_id,external_revision_id,request_profile,snapshot_path,content_sha256,fetched_at) VALUES (1,'Q1',1,'subject-v1','y',?,'x')", ("1"*64,))
            connection.execute("INSERT INTO entities(id,wikidata_id,entity_type,canonical_name,snapshot_id,created_at,updated_at) VALUES (7,'Q1','group','G',1,'x','x')")
            connection.execute("INSERT INTO entity_aliases(id,entity_id,name,language,alias_type,snapshot_id) VALUES (8,7,'G','en','label',1)")
            connection.execute("""INSERT INTO facts(
                id,subject_entity_id,predicate,property_id,statement_id,rank,
                value_time,value_precision,value_calendar,value_raw_json,
                qualifiers_json,references_json,status,quality_flags_json,
                snapshot_id,fact_run_id,extractor_version,extracted_at
            ) VALUES (9,7,'formed_on','P571','Q1$date','normal','2020',9,'Q1985727','{}','{}','[]','accepted','[]',1,1,'v','x')""")
            connection.execute("""INSERT INTO fact_evidence(
                id,fact_id,evidence_type,wikidata_snapshot_id,reference_hash,source_key,locator
            ) VALUES (10,9,'wikidata_reference',1,'abc','domain:example.com','P571/reference/abc')""")
            connection.execute("INSERT INTO catalog_entity_links(source_page_id,entity_id,requested_wikidata_id,resolved_wikidata_id,linked_at) VALUES (1,7,'Q1','Q1','x')")
            connection.commit()
            apply_migrations(connection, MIGRATIONS)
            self.assertEqual(connection.execute("SELECT id FROM entities").fetchone()[0], 7)
            self.assertEqual(connection.execute("SELECT id FROM entity_aliases").fetchone()[0], 8)
            self.assertEqual(connection.execute("SELECT id FROM facts").fetchone()[0], 9)
            self.assertEqual(connection.execute("SELECT id FROM fact_evidence").fetchone()[0], 10)
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            sql = connection.execute("SELECT sql FROM sqlite_master WHERE name='entities'").fetchone()[0]
            self.assertIn("'album'", sql)
            self.assertIsNotNone(connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='release_discovery_groups'"
            ).fetchone())
            connection.close()

    def test_failed_release_migration_restores_v5_schema_and_foreign_keys(self):
        connection = sqlite3.connect(":memory:")
        connection.execute("PRAGMA foreign_keys=ON")
        apply_migrations(connection, MIGRATIONS[:5])
        version, name, statements = MIGRATIONS[5]
        broken = (*MIGRATIONS[:5], (version, name, (*statements, "INVALID SQL")))
        with self.assertRaises(sqlite3.OperationalError):
            apply_migrations(connection, broken)
        self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        self.assertIsNotNone(connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='entities'"
        ).fetchone())
        self.assertIsNone(connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='entities_v5'"
        ).fetchone())
        self.assertIsNone(connection.execute(
            "SELECT 1 FROM schema_migrations WHERE version=6"
        ).fetchone())


if __name__ == "__main__":
    unittest.main()
