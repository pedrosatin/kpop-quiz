import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.cli import main
from kpop_scraping.fact_pipeline import EXTRACTOR_VERSION, extract_facts
from kpop_scraping.fact_store import FactRunTotals, FactStore
from kpop_scraping.reports import export_fact_coverage_csv
from kpop_scraping.storage import MIGRATIONS, Repository, SnapshotIntegrityError, apply_migrations
from kpop_scraping.wikidata import EntityBatch, EntityDocument

from .wikidata_fixture import (
    NAYEON,
    RED_VELVET,
    SUNMI,
    TWICE,
    TZUYU,
    WONDER_GIRLS,
    FixtureWikidataClient,
    build_catalog,
    load_fixture,
)


def scalar(repository, query, parameters=()):
    return repository.connection.execute(query, parameters).fetchone()[0]


class FactPipelineTest(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture()
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def repository(self):
        return Repository(self.root / "test.db", raw_dir=self.root / "raw")

    def test_migration_creates_fact_tables(self):
        with self.repository() as repository:
            tables = {
                row[0]
                for row in repository.connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            version = scalar(repository, "SELECT MAX(version) FROM schema_migrations")
        self.assertEqual(version, 8)
        self.assertTrue(
            {
                "fact_runs",
                "wikidata_entity_snapshots",
                "fact_run_snapshots",
                "fact_issues",
                "entities",
                "entity_aliases",
                "facts",
                "fact_evidence",
                "catalog_entity_links",
            }
            <= tables
        )

    def test_batches_are_sequential_and_bounded(self):
        client = FixtureWikidataClient(self.fixture)
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            totals = extract_facts(repository, client, batch_size=2)
        self.assertEqual(
            [(profile, len(ids)) for profile, ids in client.calls],
            [
                ("subject-v1", 2),
                ("subject-v1", 1),
                ("subject-v1", 2),
                ("subject-v1", 2),
                ("subject-v1", 2),
                ("country-v1", 2),
                ("label-v1", 2),
                ("label-v1", 2),
                ("label-v1", 2),
                ("label-v1", 2),
                ("label-v1", 1),
            ],
        )
        self.assertEqual(totals.batches, len(client.calls))
        self.assertEqual(totals.groups, 3)

    def test_repeated_run_does_not_duplicate_entities_facts_or_snapshots(self):
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            first = extract_facts(repository, FixtureWikidataClient(self.fixture))
            counts = self._counts(repository)
            fact_ids = repository.connection.execute(
                "SELECT statement_id, id FROM facts ORDER BY id"
            ).fetchall()
            second = extract_facts(repository, FixtureWikidataClient(self.fixture))
            self.assertEqual(self._counts(repository), counts)
            self.assertEqual(
                repository.connection.execute(
                    "SELECT statement_id, id FROM facts ORDER BY id"
                ).fetchall(),
                fact_ids,
            )
            runs = repository.connection.execute(
                "SELECT status, extractor_version FROM fact_runs ORDER BY id"
            ).fetchall()
        self.assertEqual(first, second)
        self.assertEqual(
            [tuple(row) for row in runs],
            [("completed", EXTRACTOR_VERSION)] * 2,
        )
        snapshot_files = list((self.root / "raw" / "wikidata").rglob("*.json.gz"))
        self.assertEqual(len(snapshot_files), counts["snapshots"])

    def test_accepted_facts_point_to_reference_or_revision(self):
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            totals = extract_facts(repository, FixtureWikidataClient(self.fixture))
            orphans = scalar(
                repository,
                """
                SELECT COUNT(*) FROM facts f WHERE f.status='accepted'
                AND NOT EXISTS (SELECT 1 FROM fact_evidence e WHERE e.fact_id=f.id)
                """,
            )
            wikipedia = repository.connection.execute(
                """
                SELECT e.locator, e.snippet, sr.external_revision_id
                FROM fact_evidence e
                JOIN facts f ON f.id = e.fact_id
                JOIN entities s ON s.id = f.subject_entity_id
                JOIN entities v ON v.id = f.value_entity_id
                JOIN source_revisions sr ON sr.id = e.source_revision_id
                WHERE s.wikidata_id=? AND v.wikidata_id=? AND f.predicate='has_member'
                """,
                (TWICE, NAYEON),
            ).fetchone()
            reference = repository.connection.execute(
                """
                SELECT e.reference_hash, e.source_key, ws.wikidata_id,
                       ws.external_revision_id
                FROM fact_evidence e
                JOIN facts f ON f.id = e.fact_id
                JOIN wikidata_entity_snapshots ws ON ws.id = e.wikidata_snapshot_id
                JOIN entities s ON s.id = f.subject_entity_id
                WHERE s.wikidata_id=? AND f.predicate='born_on'
                ORDER BY e.id LIMIT 1
                """,
                (TZUYU,),
            ).fetchone()
        self.assertGreater(totals.accepted, 0)
        self.assertEqual(orphans, 0)
        self.assertEqual(
            wikipedia["locator"],
            "wikipedia:en:pageid=46657634:revid=1374378392#extract[140:146]",
        )
        self.assertIn("Nayeon", wikipedia["snippet"])
        self.assertEqual(wikipedia["external_revision_id"], 1374378392)
        self.assertEqual(reference["wikidata_id"], TZUYU)
        self.assertEqual(reference["external_revision_id"], 2543444508)
        self.assertEqual(len(reference["reference_hash"]), 40)
        self.assertEqual(reference["source_key"], "domain:twicejapan.com")

    def test_conflict_is_stored_but_not_accepted(self):
        client = FixtureWikidataClient(self.fixture)
        claims = client.subjects[RED_VELVET]["claims"]
        second_country = json.loads(json.dumps(claims["P495"][0]))
        second_country["id"] = f"{RED_VELVET}$second-origin-country"
        second_country["mainsnak"]["datavalue"]["value"].update(
            {"id": "Q865", "numeric-id": 865}
        )
        claims["P495"].append(second_country)
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            totals = extract_facts(repository, client)
            rows = repository.connection.execute(
                """
                SELECT f.status, f.status_reason, COUNT(e.id) AS evidence
                FROM facts f LEFT JOIN fact_evidence e ON e.fact_id = f.id
                WHERE f.predicate='origin_country'
                  AND f.subject_entity_id=(SELECT id FROM entities WHERE wikidata_id=?)
                GROUP BY f.id ORDER BY f.id
                """,
                (RED_VELVET,),
            ).fetchall()
        self.assertEqual(
            [tuple(row) for row in rows],
            [
                ("conflict", "same_rank_values_differ", 1),
                ("conflict", "same_rank_values_differ", 0),
            ],
        )
        self.assertEqual(totals.conflict, 6)

    def test_entities_types_aliases_and_issues(self):
        client = FixtureWikidataClient(self.fixture)
        del client.labels["Q50412"]
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, client)
            types = dict(
                repository.connection.execute(
                    "SELECT wikidata_id, entity_type FROM entities"
                ).fetchall()
            )
            sunmi_name = scalar(
                repository, "SELECT canonical_name FROM entities WHERE wikidata_id=?", (SUNMI,)
            )
            romanization = scalar(
                repository,
                """
                SELECT a.name FROM entity_aliases a JOIN entities e ON e.id=a.entity_id
                WHERE e.wikidata_id=? AND a.alias_type='romanization'
                """,
                (TWICE,),
            )
            issue = repository.connection.execute(
                "SELECT wikidata_id, issue_code FROM fact_issues"
            ).fetchone()
            missing_value = repository.connection.execute(
                "SELECT status, status_reason FROM facts WHERE value_wikidata_id='Q50412'"
            ).fetchone()
        self.assertEqual(types[TWICE], "group")
        self.assertEqual(types[NAYEON], "person")
        self.assertEqual(types["Q483238"], "organization")
        self.assertEqual(types["Q8684"], "place")
        self.assertEqual(types["Q213665"], "genre")
        self.assertEqual(types["Q9176"], "language")
        self.assertEqual(types["Q17172850"], "instrument")
        self.assertEqual(sunmi_name, "Lee Sunmi")
        self.assertEqual(romanization, "Towaisu")
        self.assertEqual(tuple(issue), ("Q50412", "entity_missing"))
        self.assertEqual(tuple(missing_value), ("rejected", "value_entity_missing"))

    def test_group_limit_and_removed_statement(self):
        client = FixtureWikidataClient(self.fixture)
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            totals = extract_facts(repository, client, group_limit=1)
            groups = [
                row[0]
                for row in repository.connection.execute(
                    "SELECT wikidata_id FROM entities WHERE source_page_id IS NOT NULL"
                )
            ]
            before = scalar(repository, "SELECT COUNT(*) FROM facts WHERE predicate='formed_on'")
            client.subjects[WONDER_GIRLS]["claims"]["P571"] = []
            client.subjects[WONDER_GIRLS]["lastrevid"] += 1
            extract_facts(repository, client, group_limit=1)
            after = scalar(repository, "SELECT COUNT(*) FROM facts WHERE predicate='formed_on'")
        self.assertEqual(totals.groups, 1)
        self.assertEqual(groups, [WONDER_GIRLS])
        self.assertEqual((before, after), (1, 0))

    def test_missing_selected_group_retires_its_previous_facts(self):
        client = FixtureWikidataClient(self.fixture)
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, client)
            previous = scalar(
                repository,
                """
                SELECT COUNT(*) FROM facts f
                JOIN entities e ON e.id = f.subject_entity_id
                WHERE e.wikidata_id=? AND f.status = 'accepted'
                """,
                (WONDER_GIRLS,),
            )
            del client.subjects[WONDER_GIRLS]
            totals = extract_facts(repository, client, group_limit=1)
            statuses = repository.connection.execute(
                """
                SELECT DISTINCT f.status, f.status_reason FROM facts f
                JOIN entities e ON e.id = f.subject_entity_id
                WHERE e.wikidata_id=?
                """,
                (WONDER_GIRLS,),
            ).fetchall()
            issue = repository.connection.execute(
                """
                SELECT issue_code FROM fact_issues
                WHERE wikidata_id=? ORDER BY id DESC LIMIT 1
                """,
                (WONDER_GIRLS,),
            ).fetchone()
        self.assertGreater(previous, 0)
        self.assertEqual(totals.groups, 0)
        self.assertGreaterEqual(totals.stale, previous)
        self.assertIn(("stale", "subject_unavailable"), [tuple(row) for row in statuses])
        self.assertTrue(
            {row["status"] for row in statuses}
            <= {"rejected", "conflict", "superseded", "stale"}
        )
        self.assertEqual(issue["issue_code"], "entity_missing")

    def test_redirected_group_remains_current_through_its_catalog_page(self):
        client = FixtureWikidataClient(self.fixture)
        resolved_id = "Q999999999"
        resolved = json.loads(json.dumps(client.subjects[WONDER_GIRLS]))
        resolved["id"] = resolved_id
        for statements in resolved["claims"].values():
            for item in statements:
                item["id"] = item["id"].replace(WONDER_GIRLS, resolved_id)

        original_get_entities = client.get_entities

        def redirected_entities(ids, profile):
            requested = list(ids)
            if profile.name == "subject-v1" and WONDER_GIRLS in requested:
                client.calls.append((profile.name, tuple(requested)))
                documents = [
                    EntityDocument(WONDER_GIRLS, resolved_id, resolved["lastrevid"], resolved)
                ]
                remaining = [qid for qid in requested if qid != WONDER_GIRLS]
                if remaining:
                    batch = original_get_entities(remaining, profile)
                    documents.extend(batch.documents)
                    return EntityBatch(tuple(documents), batch.missing)
                return EntityBatch(tuple(documents), ())
            return original_get_entities(requested, profile)

        client.get_entities = redirected_entities
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, client, group_limit=1)
            statuses = repository.connection.execute(
                """
                SELECT DISTINCT f.status FROM facts f
                JOIN entities e ON e.id = f.subject_entity_id
                WHERE e.wikidata_id=?
                """,
                (resolved_id,),
            ).fetchall()
            link = repository.connection.execute(
                """
                SELECT requested_wikidata_id, resolved_wikidata_id
                FROM catalog_entity_links
                """
            ).fetchone()
            report = self.root / "redirected-facts.csv"
            row_count = export_fact_coverage_csv(repository.connection, report)
            repository.connection.execute(
                """
                INSERT INTO catalog_entity_links(
                    source_page_id, entity_id, requested_wikidata_id,
                    resolved_wikidata_id, fact_run_id, linked_at
                )
                SELECT ce.source_page_id, e.id, ce.analyzed_wikidata_id,
                       e.wikidata_id, e.last_fact_run_id, e.updated_at
                FROM catalog_entries ce, entities e
                WHERE ce.analyzed_wikidata_id != ? AND e.wikidata_id = ?
                ORDER BY ce.source_page_id LIMIT 1
                """,
                (WONDER_GIRLS, resolved_id),
            )
            deduplicated_row_count = export_fact_coverage_csv(
                repository.connection, self.root / "deduplicated-facts.csv"
            )
        self.assertTrue(statuses)
        self.assertNotIn("stale", {row["status"] for row in statuses})
        self.assertEqual(tuple(link), (WONDER_GIRLS, resolved_id))
        self.assertEqual(row_count, 12)
        with report.open(encoding="utf-8", newline="") as handle:
            report_qids = {row["group_wikidata_id"] for row in csv.DictReader(handle)}
        self.assertEqual(report_qids, {resolved_id})
        self.assertEqual(deduplicated_row_count, 12)

    def test_nonaccepted_membership_retires_person_facts(self):
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, FixtureWikidataClient(self.fixture))
            person_id = scalar(
                repository,
                "SELECT id FROM entities WHERE wikidata_id=?",
                (NAYEON,),
            )
            repository.connection.execute(
                "UPDATE facts SET status='rejected', status_reason='test_rejection' "
                "WHERE predicate='has_member' AND value_entity_id=?",
                (person_id,),
            )
            repository.connection.execute(
                "UPDATE facts SET status='accepted', status_reason=NULL "
                "WHERE subject_entity_id=?",
                (person_id,),
            )
            repository.connection.execute(
                "UPDATE facts SET status='rejected', status_reason='test_rejection' "
                "WHERE subject_entity_id=? AND predicate='born_on'",
                (person_id,),
            )
            store = FactStore(repository)
            run_id = store.start_run(EXTRACTOR_VERSION, None)
            store.mark_stale_facts(run_id)
            statuses = {
                row[0]
                for row in repository.connection.execute(
                    "SELECT status FROM facts WHERE subject_entity_id=?",
                    (person_id,),
                )
            }
            repository.connection.execute(
                "UPDATE facts SET status='conflict', status_reason='test_conflict' "
                "WHERE predicate='has_member' AND value_entity_id=?",
                (person_id,),
            )
            repository.connection.execute(
                "UPDATE facts SET status='accepted', status_reason=NULL "
                "WHERE subject_entity_id=?",
                (person_id,),
            )
            repository.connection.execute(
                "UPDATE facts SET status='conflict', status_reason='test_conflict' "
                "WHERE subject_entity_id=? AND predicate='born_on'",
                (person_id,),
            )
            run_id = store.start_run(EXTRACTOR_VERSION, None)
            store.mark_stale_facts(run_id)
            conflict_statuses = {
                row[0]
                for row in repository.connection.execute(
                    "SELECT status FROM facts WHERE subject_entity_id=?",
                    (person_id,),
                )
            }
        self.assertEqual(statuses, {"rejected", "stale"})
        self.assertEqual(conflict_statuses, {"conflict", "stale"})

    def test_migration_backfills_latest_group_when_page_identity_changed(self):
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, FixtureWikidataClient(self.fixture), group_limit=1)
            original = repository.connection.execute(
                "SELECT * FROM entities WHERE wikidata_id=?",
                (WONDER_GIRLS,),
            ).fetchone()
            repository.connection.execute("DROP TABLE catalog_entity_links")
            repository.connection.execute("DELETE FROM schema_migrations WHERE version=5")
            repository.connection.execute(
                """
                INSERT INTO entities(
                    wikidata_id, entity_type, canonical_name, snapshot_id,
                    source_page_id, last_fact_run_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "Q999999998",
                    original["entity_type"],
                    "Replacement group",
                    original["snapshot_id"],
                    original["source_page_id"],
                    original["last_fact_run_id"],
                    original["created_at"],
                    "9999-12-31T23:59:59+00:00",
                ),
            )
            replacement_id = repository.connection.execute(
                "SELECT id FROM entities WHERE wikidata_id='Q999999998'"
            ).fetchone()[0]
            apply_migrations(repository.connection, MIGRATIONS)
            link = repository.connection.execute(
                "SELECT entity_id, resolved_wikidata_id FROM catalog_entity_links"
            ).fetchone()
        self.assertEqual(tuple(link), (replacement_id, "Q999999998"))

    def test_limited_run_does_not_promote_membership_without_group_counterpart(self):
        client = FixtureWikidataClient(self.fixture)
        membership = json.loads(json.dumps(client.subjects[SUNMI]["claims"]["P463"][0]))
        membership["id"] = f"{SUNMI}$unverified-red-velvet-membership"
        membership["mainsnak"]["datavalue"]["value"].update(
            {"id": RED_VELVET, "numeric-id": 17466114}
        )
        membership["qualifiers"] = {}
        membership["references"] = [
            {
                "hash": "reliable-reference",
                "snaks": {
                    "P854": [
                        {
                            "snaktype": "value",
                            "datavalue": {
                                "type": "string",
                                "value": "https://www.jype.com/artist/sunmi",
                            },
                        }
                    ]
                },
            }
        ]
        client.subjects[SUNMI]["claims"]["P463"].append(membership)
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, client)
            first = repository.connection.execute(
                "SELECT status, status_reason FROM facts WHERE statement_id=?",
                (membership["id"],),
            ).fetchone()
            extract_facts(repository, client, group_limit=1)
            limited = repository.connection.execute(
                "SELECT status, status_reason FROM facts WHERE statement_id=?",
                (membership["id"],),
            ).fetchone()
        expected = ("conflict", "membership_counterpart_unverified")
        self.assertEqual(tuple(first), expected)
        self.assertEqual(tuple(limited), expected)

    def test_failure_rolls_back_facts_and_marks_run(self):
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            client = FixtureWikidataClient(self.fixture)
            extract_facts(repository, client)
            counts = self._counts(repository)
            with patch.object(
                repository.snapshots,
                "read",
                side_effect=SnapshotIntegrityError("snapshot hash mismatch"),
            ):
                with self.assertRaisesRegex(SnapshotIntegrityError, "hash mismatch"):
                    extract_facts(repository, FixtureWikidataClient(self.fixture))
            self.assertEqual(self._counts(repository), counts)
            run = repository.connection.execute(
                "SELECT status, error FROM fact_runs ORDER BY id DESC LIMIT 1"
            ).fetchone()
        self.assertEqual(run["status"], "failed")
        self.assertIn("hash mismatch", run["error"])

    def test_changed_content_for_same_entity_revision_is_rejected(self):
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, FixtureWikidataClient(self.fixture), group_limit=1)
            client = FixtureWikidataClient(self.fixture)
            client.subjects[WONDER_GIRLS]["labels"]["en"]["value"] = "Changed"
            with self.assertRaisesRegex(SnapshotIntegrityError, "changed content"):
                extract_facts(repository, client, group_limit=1)

    def test_coverage_report_counts_statuses_and_missing_predicates(self):
        report = self.root / "reports" / "facts.csv"
        with self.repository() as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, FixtureWikidataClient(self.fixture))
            row_count = export_fact_coverage_csv(repository.connection, report)
        with report.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        by_key = {(row["group_wikidata_id"], row["scope"], row["predicate"]): row for row in rows}
        self.assertEqual(row_count, 36)
        genre = by_key[(RED_VELVET, "group", "genre")]
        self.assertEqual(
            (
                genre["facts"],
                genre["accepted"],
                genre["rejected"],
                genre["superseded"],
                genre["coverage"],
            ),
            ("2", "0", "1", "1", "no_accepted"),
        )
        self.assertEqual(by_key[(TWICE, "group", "formed_on")]["coverage"], "missing")
        born = by_key[(RED_VELVET, "member", "born_on")]
        self.assertEqual(
            (born["subjects"], born["accepted"], born["rejected"], born["coverage"]),
            ("2", "0", "2", "no_accepted"),
        )
        formed = by_key[(WONDER_GIRLS, "group", "formed_on")]
        self.assertEqual((formed["rejected"], formed["coverage"]), ("1", "no_accepted"))

    def _counts(self, repository):
        return {
            "entities": scalar(repository, "SELECT COUNT(*) FROM entities"),
            "aliases": scalar(repository, "SELECT COUNT(*) FROM entity_aliases"),
            "facts": scalar(repository, "SELECT COUNT(*) FROM facts"),
            "evidence": scalar(repository, "SELECT COUNT(*) FROM fact_evidence"),
            "snapshots": scalar(repository, "SELECT COUNT(*) FROM wikidata_entity_snapshots"),
        }


class FactCliTest(unittest.TestCase):
    def test_fact_stage_runs_only_when_requested(self):
        totals = FactRunTotals(1, 2, 3, 4, 5, 6, 7, 8)
        with tempfile.TemporaryDirectory() as directory, patch(
            "kpop_scraping.cli.collect_category", return_value=0
        ), patch("kpop_scraping.cli.classify_catalog") as classify, patch(
            "kpop_scraping.cli.extract_facts", return_value=totals
        ) as extract, patch(
            "kpop_scraping.cli.export_fact_coverage_csv", return_value=12
        ) as export, patch("builtins.print"):
            classify.return_value.accepted = 0
            database = Path(directory) / "test.db"
            self.assertEqual(main(["--limit", "3", "--database", str(database)]), 0)
            extract.assert_not_called()
            report = Path(directory) / "facts.csv"
            arguments = ["--database", str(database), "--facts-limit", "30", "--facts-report", str(report)]
            self.assertEqual(main(arguments), 0)
        self.assertEqual(extract.call_args.kwargs["group_limit"], 30)
        self.assertEqual(export.call_args.args[1], report)

    def test_rejects_invalid_fact_limit(self):
        with self.assertRaisesRegex(SystemExit, "--facts-limit"):
            main(["--facts-limit", "0"])

    def test_release_offset_beyond_catalog_fails_without_traceback(self):
        totals = FactRunTotals(0, 0, 0, 0, 0, 0, 0, 0)
        with tempfile.TemporaryDirectory() as directory, patch(
            "kpop_scraping.cli.collect_category", return_value=0
        ), patch("kpop_scraping.cli.classify_catalog") as classify, patch(
            "kpop_scraping.cli.extract_facts", return_value=totals
        ), patch(
            "kpop_scraping.cli.export_fact_coverage_csv", return_value=0
        ), patch(
            "kpop_scraping.cli.discover_releases",
            side_effect=ValueError("no accepted catalog groups are available"),
        ), patch("builtins.print") as output:
            classify.return_value.accepted = 0
            classify.return_value.rejected = 0
            classify.return_value.pending = 0
            database = Path(directory) / "test.db"
            result = main([
                "--database", str(database), "--releases",
                "--release-group-offset", "999",
            ])

        self.assertEqual(result, 1)
        output.assert_any_call(
            "Pipeline failed: ValueError: no accepted catalog groups are available"
        )


if __name__ == "__main__":
    unittest.main()
