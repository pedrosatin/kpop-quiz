import json
import sqlite3
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from kpop_scraping.evidence import WikipediaPage, release_date_evidence, release_performer_evidence
from kpop_scraping.entities import GREGORIAN_CALENDAR, TimeValue
from kpop_scraping.mediawiki import MediaWikiError, Page
from kpop_scraping.release_evidence import _page_rejection, collect_release_pages
from kpop_scraping.release_discovery import WikidataQueryClient, _parse_results, build_query
from kpop_scraping.release_facts import release_entity_type, release_fact_candidates
from kpop_scraping.release_pipeline import (
    _mark_stale_releases,
    _performer_entity_ids,
    collect_release_facts,
)
from kpop_scraping.storage import MIGRATIONS, Repository, apply_migrations
from kpop_scraping.wikidata import EntityBatch, EntityDocument


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

    def test_release_text_rules_pass_editorial_positive_and_negative_cases(self):
        date = TimeValue("2020-01-02", 11, GREGORIAN_CALENDAR)
        positives = (
            ("en", "Alpha is an album by Group One, released on January 2, 2020.", "Group One"),
            ("en", "Alpha is the debut EP by Group One. Alpha was released on 2 January 2020.", "Group One"),
            ("pt", "Alpha é um álbum por Group One. Alpha foi lançado em 2 de janeiro de 2020.", "Group One"),
            ("en", "Alpha is an album by singer Group One. Alpha was released on January 2, 2020.", "Group One"),
            ("en", "Alpha is a studio album by Group One. It was released on January 2, 2020.", "Group One"),
            ("en", "Alpha is a single by Group One. The single was released on January 2, 2020.", "Group One"),
            ("en", "Alpha is a song recorded by Group One. It was released on 2 January 2020.", "Group One"),
            ("en", "Alpha is an album by South Korean group Group One. It was released on January 2, 2020.", "Group One"),
            ("en", "Alpha is an EP by Korean girl group Group One, released on January 2, 2020.", "Group One"),
            ("en", "Alpha is a single by Japanese band Group One. Alpha was released on 2 January 2020.", "Group One"),
            ("en", "Alpha is a record by Thai artist Group One. It was released on January 2, 2020.", "Group One"),
            ("en", "Alpha is a song by rapper Group One. Alpha was released on January 2, 2020.", "Group One"),
            ("pt", "Alpha é um single por Group One. Ele foi lançado em 2 de janeiro de 2020.", "Group One"),
            ("pt", "Alpha é um álbum por Group One, lançado em 2 de janeiro de 2020.", "Group One"),
            ("pt", "Alpha é um álbum por Group One. Ele foi lançado em 2 de janeiro de 2020.", "Group One"),
            ("en", "Alpha is an EP by duo Group One. It was released on 2 January 2020.", "Group One"),
        )
        for index, (language, extract, performer) in enumerate(positives):
            with self.subTest(kind="positive", index=index, language=language):
                page = WikipediaPage(1, language, index + 1, 10, extract, "Alpha")
                self.assertIsNotNone(release_performer_evidence(page, (performer,), ("Alpha",)))
                self.assertIsNotNone(release_date_evidence(page, date, ("Alpha",)))

        negatives = (
            "Alpha is a film by Group One, released on January 2, 2020.",
            "Alpha is an album. Its video was directed by Group One.",
            "Beta is an album by Group One. Alpha was released on January 2, 2020.",
            "Alpha is an album released by Label One on January 2, 2020.",
            "The album by Group One is called Alpha.",
            "Alpha is a list of albums by Group One.",
            "Alpha's producer worked with Group One.",
            "Alpha is an album inspired by Group One.",
            "Alpha is an album produced by Group One.",
            "Alpha is an album distributed by Group One.",
            "Alpha is an album with a song by Group One.",
            "Alpha is an album whose cover was designed by Group One.",
            "Alpha is an album by Group One's producer.",
            "Alpha is an album by Group One's member.",
            "Alpha is an album by Group One Productions.",
            "Alpha is an album by Group One members.",
            "Alpha is an album by Group One tribute band.",
            "Alpha is an album by Group One-inspired artists.",
        )
        for index, extract in enumerate(negatives):
            page = WikipediaPage(1, "en", index + 20, 10, extract, "Alpha")
            self.assertIsNone(release_performer_evidence(page, ("Group One",), ("Alpha",)))
        scoped_dates = (
            "Alpha is an album. Alpha was released on January 2, 2020 in Japan.",
            "Alpha is an album. Alpha was released digitally on January 2, 2020.",
            "Alpha is an album. Alpha was released on January 2, 2020 on vinyl.",
            "Alpha is an album. Alpha was released on January 2, 2020 as a physical edition.",
            "Alpha is an album. The video was released on January 2, 2020.",
            "Alpha is an album. Beta was released on January 2, 2020.",
            "Alpha is an album released in 2020.",
            "Alpha is an album. Alpha debuted on January 2, 2020.",
            "Alpha is an album. Alpha was recorded on January 2, 2020.",
            "Alpha is an album. Its video was released on January 2, 2020.",
            "Alpha is an album. Its teaser was released on January 2, 2020.",
            "Alpha is an album. Pre-orders opened on January 2, 2020.",
            "Alpha is an album. Alpha was reissued on January 2, 2020.",
            "Alpha is an album. Alpha was released on January 2, 2020 in the US.",
            "Alpha is an album. Alpha was released on January 2, 2020 as a CD.",
            "Alpha is an album. Alpha was released on January 2, 2020 in France.",
            "Alpha is an album. Alpha was released on January 2, 2020 exclusively in France.",
        )
        for index, extract in enumerate(scoped_dates):
            page = WikipediaPage(1, "en", index + 40, 10, extract, "Alpha")
            self.assertIsNone(release_date_evidence(page, date, ("Alpha",)))
        for index, extract in enumerate((
            "Alpha é um álbum. Alpha foi lançado em 2 de janeiro de 2020 no Brasil.",
            "Alpha é um álbum. Alpha foi lançado em 2 de janeiro de 2020 exclusivamente no Brasil.",
            "Alpha é um álbum. Alpha foi lançado digitalmente em 2 de janeiro de 2020.",
        )):
            page = WikipediaPage(1, "pt", 70 + index, 10, extract, "Alpha")
            self.assertIsNone(release_date_evidence(page, date, ("Alpha",)))

        wrong_subject_kind = WikipediaPage(
            1, "pt", 80, 10,
            "Alpha é um álbum por Group One. O single foi lançado em 2 de janeiro de 2020.",
            "Alpha",
        )
        self.assertIsNone(release_date_evidence(wrong_subject_kind, date, ("Alpha",)))
        matching_subject_kind = WikipediaPage(
            1, "pt", 81, 10,
            "Alpha é um single por Group One. O single foi lançado em 2 de janeiro de 2020.",
            "Alpha",
        )
        self.assertIsNotNone(release_date_evidence(matching_subject_kind, date, ("Alpha",)))

        korean = WikipediaPage(
            1, "ko", 90, 10,
            "Alpha는 Group One의 음반이다. Alpha는 2020년 1월 2일 발매되었다.",
            "Alpha",
        )
        self.assertIsNone(release_performer_evidence(korean, ("Group One",), ("Alpha",)))
        self.assertIsNotNone(release_date_evidence(korean, date, ("Alpha",)))
        for index, scoped in enumerate((
            "Alpha는 2020년 1월 2일 일본에서 발매되었다.",
            "Alpha는 2020년 1월 2일 바이닐로 출시되었다.",
            "Alpha는 2020년 1월 2일 발매 예정이었다.",
            "Alpha는 2020년 1월 2일 프랑스에서 발매되었다.",
            "Alpha는 2020년 1월 2일 독점적으로 프랑스에서 발매되었다.",
        )):
            page = WikipediaPage(1, "ko", 91 + index, 10, scoped, "Alpha")
            self.assertIsNone(release_date_evidence(page, date, ("Alpha",)))

        joint = WikipediaPage(
            1, "en", 95, 10,
            "Alpha is an album by Group One and Group Two.", "Alpha",
        )
        peers = ("Group One", "Group Two")
        self.assertIsNotNone(release_performer_evidence(joint, ("Group One",), ("Alpha",), peers))
        self.assertIsNotNone(release_performer_evidence(joint, ("Group Two",), ("Alpha",), peers))
        triple = WikipediaPage(
            1, "en", 96, 10,
            "Alpha is an album by Group One, Group Two and Group Three.", "Alpha",
        )
        three = ("Group One", "Group Two", "Group Three")
        for artist in three:
            self.assertIsNotNone(
                release_performer_evidence(triple, (artist,), ("Alpha",), three)
            )
        portuguese = WikipediaPage(
            1, "pt", 97, 10,
            "Alpha é um álbum por Group One e Group Two.", "Alpha",
        )
        for artist in peers:
            self.assertIsNotNone(
                release_performer_evidence(portuguese, (artist,), ("Alpha",), peers)
            )
        numeric = WikipediaPage(
            1, "en", 98, 10, "Alpha is an album by 2PM.", "Alpha"
        )
        self.assertIsNotNone(
            release_performer_evidence(numeric, ("2PM",), ("Alpha",), ("2PM",))
        )

    def test_release_page_policy_rejects_unsafe_sources(self):
        base = Page(1, "Alpha", "https://example.test", "Alpha is an album.", 2, wikidata_id="Q1")
        self.assertIsNone(_page_rejection(base, "Q1"))
        self.assertEqual(_page_rejection(Page(**{**base.__dict__, "title": "List of Alpha albums"}), "Q1"), "page_list")
        self.assertEqual(_page_rejection(Page(**{**base.__dict__, "wikidata_id": "Q2"}), "Q1"), "page_wikidata_mismatch")
        self.assertEqual(_page_rejection(Page(**{**base.__dict__, "is_disambiguation": True}), "Q1"), "page_disambiguation")

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


class ReleasePipelineScopeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.repository = Repository(self.root / "test.db", raw_dir=self.root / "raw")
        self.connection = self.repository.connection
        self.connection.execute(
            """INSERT INTO wikidata_entity_snapshots(
                id,wikidata_id,external_revision_id,request_profile,snapshot_path,
                content_sha256,fetched_at
            ) VALUES (1,'Q0',1,'subject-v1','fixture',?,'t')""",
            ("0" * 64,),
        )
        self.connection.executemany(
            """INSERT INTO entities(
                id,wikidata_id,entity_type,canonical_name,snapshot_id,created_at,updated_at
            ) VALUES (?,?,?,?,1,'t','t')""",
            [(1, "QG1", "group", "G1"), (2, "QG2", "group", "G2"),
             (10, "QR1", "album", "R1"), (20, "QR2", "album", "R2")],
        )
        self.connection.execute(
            "INSERT INTO collection_runs(id,category,started_at,status) VALUES (1,'x','t','completed')"
        )
        self.connection.executemany(
            """INSERT INTO source_pages(
                id,provider,language,external_page_id,title,canonical_url,
                extract,fetched_at,last_run_id
            ) VALUES (?,'wikipedia','en',?,?,?,'','t',1)""",
            [(1, 1, "G1", "u1"), (2, 2, "G2", "u2")],
        )
        self.connection.executemany(
            """INSERT INTO source_revisions(
                id,source_page_id,external_revision_id,snapshot_path,content_sha256,fetched_at
            ) VALUES (?,?,?,?,?,'t')""",
            [(1, 1, 1, "s1", "1" * 64), (2, 2, 2, "s2", "2" * 64)],
        )
        self.connection.execute(
            "INSERT INTO catalog_runs(id,classifier_version,started_at,status) VALUES (1,'v','t','completed')"
        )
        self.connection.executemany(
            """INSERT INTO catalog_entries(
                source_page_id,source_revision_id,analyzed_wikidata_id,state,
                classifier_version,classified_at
            ) VALUES (?,?,?,'accepted','v','t')""",
            [(1, 1, "QG1"), (2, 2, "QG2")],
        )
        self.connection.executemany(
            """INSERT INTO catalog_entity_links(
                source_page_id,entity_id,requested_wikidata_id,resolved_wikidata_id,linked_at
            ) VALUES (?,?,?,?, 't')""",
            [(1, 1, "QG1", "QG1"), (2, 2, "QG2", "QG2")],
        )

    def tearDown(self):
        self.connection.close()
        self.directory.cleanup()

    def _run(self, status="completed", groups=(1,)):
        cursor = self.connection.execute(
            """INSERT INTO release_discovery_runs(
                discoverer_version,query,query_sha256,endpoint,started_at,status
            ) VALUES ('v','q',?,'e','t',?)""",
            ("0" * 64, status),
        )
        run_id = int(cursor.lastrowid)
        self.connection.executemany(
            "INSERT INTO release_discovery_groups(run_id,group_entity_id) VALUES (?,?)",
            [(run_id, group_id) for group_id in groups],
        )
        self.connection.commit()
        return run_id

    def test_rejects_unknown_incomplete_and_empty_discovery_before_fact_run(self):
        run_ids = [999, self._run("running"), self._run("failed"), self._run(groups=())]
        for run_id in run_ids:
            with self.subTest(run_id=run_id), self.assertRaises(ValueError):
                collect_release_facts(self.repository, object(), run_id)
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) FROM fact_runs").fetchone()[0], 0
        )

    def test_staleness_only_mutates_groups_in_discovery_scope(self):
        old_run = self._run(groups=(1, 2))
        self.connection.executemany(
            """INSERT INTO release_candidates(
                run_id,group_entity_id,requested_wikidata_id,resolved_wikidata_id,
                entity_id,state
            ) VALUES (?,?,?,?,?,'accepted')""",
            [(old_run, 1, "QR1", "QR1", 10), (old_run, 2, "QR2", "QR2", 20)],
        )
        current_run = self._run(groups=(1,))
        fact_run = self.connection.execute(
            """INSERT INTO fact_runs(
                extractor_version,source_policy_version,started_at,status
            ) VALUES ('v','v','t','running')"""
        ).lastrowid

        _mark_stale_releases(self.connection, current_run, fact_run)

        states = self.connection.execute(
            "SELECT group_entity_id,state FROM release_candidates ORDER BY group_entity_id"
        ).fetchall()
        self.assertEqual([tuple(row) for row in states], [(1, "stale"), (2, "accepted")])

    def test_staleness_rolls_back_with_the_fact_run(self):
        old_run = self._run(groups=(1,))
        self.connection.execute(
            """INSERT INTO release_candidates(
                run_id,group_entity_id,requested_wikidata_id,resolved_wikidata_id,
                entity_id,state
            ) VALUES (?,1,'QR1','QR1',10,'accepted')""",
            (old_run,),
        )
        current_run = self._run(groups=(1,))
        with patch(
            "kpop_scraping.release_pipeline.count_statuses",
            side_effect=RuntimeError("after staleness"),
        ), self.assertRaisesRegex(RuntimeError, "after staleness"):
            collect_release_facts(self.repository, object(), current_run)

        state = self.connection.execute(
            "SELECT state FROM release_candidates WHERE run_id=?", (old_run,)
        ).fetchone()[0]
        self.assertEqual(state, "accepted")
        fact_run = self.connection.execute(
            "SELECT status,error FROM fact_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(tuple(fact_run), ("failed", "after staleness"))

    def test_metrics_count_scope_groups_and_only_saved_release_entities(self):
        run_id = self._run(groups=(1,))

        first = collect_release_facts(self.repository, object(), run_id)
        second = collect_release_facts(self.repository, object(), run_id)

        self.assertEqual((first.groups, first.entities), (1, 0))
        self.assertEqual(second, first)
        persisted = self.connection.execute(
            """SELECT groups_processed,entities_saved FROM fact_runs
            ORDER BY id DESC LIMIT 2"""
        ).fetchall()
        self.assertEqual([tuple(row) for row in persisted], [(1, 0), (1, 0)])

    def test_redirect_convergence_counts_and_extracts_release_once(self):
        run_id = self._run(groups=(1,))
        self.connection.executemany(
            """INSERT INTO release_candidates(
                run_id,group_entity_id,requested_wikidata_id,state
            ) VALUES (?,1,?,'candidate')""",
            [(run_id, "Q110"), (run_id, "Q120")],
        )
        self.connection.commit()
        payload = {
            "id": "Q101",
            "lastrevid": 2,
            "labels": {"en": {"language": "en", "value": "R1"}},
            "aliases": {},
            "claims": {
                "P31": [item_statement("Q101$class", "P31", "Q482994")],
                "P175": [item_statement("Q101$performer", "P175", "QG1")],
                "P577": [{**time_statement(), "rank": "deprecated"}],
            },
        }

        class Client:
            def get_entities(self, qids, _profile):
                return EntityBatch(
                    tuple(EntityDocument(qid, "Q101", 2, payload) for qid in qids),
                    (),
                )

        totals = collect_release_facts(self.repository, Client(), run_id)

        self.assertEqual(totals.entities, 1)
        self.assertEqual(totals.rejected, 1)
        self.assertEqual(totals.ignored, 1)
        self.assertEqual(
            self.connection.execute(
                """SELECT COUNT(*) FROM facts f JOIN entities e
                ON e.id=f.subject_entity_id WHERE e.wikidata_id='Q101'"""
            ).fetchone()[0],
            1,
        )

    def test_wikipedia_revision_accepts_release_artist_and_date(self):
        run_id = self._run(groups=(1,))
        self.connection.execute(
            "INSERT INTO entity_aliases(entity_id,name,language,alias_type,snapshot_id) VALUES (1,'Group One','en','label',1)"
        )
        self.connection.execute(
            "INSERT INTO release_candidates(run_id,group_entity_id,requested_wikidata_id,state) VALUES (?,1,'Q101','candidate')",
            (run_id,),
        )
        self.connection.commit()
        payload = {
            "id": "Q101", "lastrevid": 2,
            "labels": {"en": {"language": "en", "value": "Alpha"}},
            "aliases": {},
            "sitelinks": {
                "enwiki": {"title": "Alpha (album)"},
                "ptwiki": {"title": "Alpha (álbum)"},
            },
            "claims": {
                "P31": [item_statement("Q101$class", "P31", "Q482994")],
                "P175": [item_statement("Q101$performer", "P175", "QG1")],
                "P577": [time_statement()],
            },
        }

        class EntityClient:
            def get_entities(self, qids, _profile):
                return EntityBatch(
                    tuple(EntityDocument(qid, qid, 2, payload) for qid in qids), ()
                )

        class WikiClient:
            def __init__(self, language):
                self.language = language

            def get_pages_by_titles(self, _titles):
                if self.language == "en":
                    return [Page(
                        77, "Alpha (album)", "https://en.wikipedia.org/wiki/Alpha",
                        "Alpha is an album about music.", 88, wikidata_id="Q101",
                    )]
                return [Page(
                    78, "Alpha (álbum)", "https://pt.wikipedia.org/wiki/Alpha",
                    "Alpha é um álbum por Group One. Alpha foi lançado em 2 de janeiro de 2020.",
                    89, wikidata_id="Q101",
                )]

        totals = collect_release_facts(
            self.repository, EntityClient(), run_id,
            wikipedia_clients={"en": WikiClient("en"), "pt": WikiClient("pt")},
        )

        self.assertEqual(totals.accepted, 2)
        evidence = self.connection.execute(
            """SELECT f.predicate,fe.source_revision_id,fe.locator
            FROM facts f JOIN fact_evidence fe ON fe.fact_id=f.id
            WHERE f.subject_entity_id=(SELECT id FROM entities WHERE wikidata_id='Q101')
            ORDER BY f.predicate"""
        ).fetchall()
        self.assertEqual([row["predicate"] for row in evidence], ["performed_by", "released_on"])
        self.assertTrue(all(row["source_revision_id"] for row in evidence))
        self.assertTrue(all("pageid=78:revid=89#extract" in row["locator"] for row in evidence))
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) FROM catalog_entries WHERE source_page_id IN (SELECT id FROM source_pages WHERE external_page_id IN (77,78))"
            ).fetchone()[0],
            0,
        )
        repeated = collect_release_facts(
            self.repository, EntityClient(), run_id,
            wikipedia_clients={"en": WikiClient("en"), "pt": WikiClient("pt")},
        )
        self.assertEqual(repeated.accepted, 2)
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) FROM source_revisions WHERE external_revision_id IN (88,89)"
            ).fetchone()[0],
            2,
        )


if __name__ == "__main__":
    unittest.main()
