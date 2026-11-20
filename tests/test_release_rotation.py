"""Rodízio noturno da descoberta de lançamentos (ticket invariantes-implicitos/12)."""

from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.cli import main
from kpop_scraping.exit_codes import EXIT_DETERMINISTIC, EXIT_OK, EXIT_TRANSIENT
from kpop_scraping.fact_store import FactRunTotals
from kpop_scraping.mediawiki import MediaWikiError
from kpop_scraping.release_discovery import (
    MAX_GROUPS_PER_QUERY,
    count_accepted_catalog_groups,
    release_batch_count,
    rotated_release_group_offset,
)
from kpop_scraping.storage import Repository, SnapshotIntegrityError


def _seed_accepted_groups(repository: Repository, qids: list[str]) -> None:
    repository.connection.execute(
        "INSERT INTO collection_runs(id,category,started_at,status) VALUES (1,'x','t','completed')"
    )
    repository.connection.execute(
        "INSERT INTO wikidata_entity_snapshots(id,wikidata_id,external_revision_id,request_profile,"
        "snapshot_path,content_sha256,fetched_at) VALUES (1,'Q0',1,'subject-v1','fixture',?,'t')",
        ("0" * 64,),
    )
    repository.connection.execute(
        "INSERT INTO catalog_runs(id,classifier_version,started_at,status) VALUES (1,'v','t','completed')"
    )
    for qid in qids:
        entity_id = repository.connection.execute(
            "INSERT INTO entities(entity_type,wikidata_id,canonical_name,snapshot_id,created_at,updated_at) "
            "VALUES ('group',?,?,1,'t','t')",
            (qid, qid),
        ).lastrowid
        page_id = repository.connection.execute(
            "INSERT INTO source_pages(provider,language,external_page_id,title,canonical_url,extract,"
            "fetched_at,last_run_id) VALUES ('wikipedia','en',?,?,?,'','t',1)",
            (int(qid[1:]), qid, f"https://example.test/{qid}"),
        ).lastrowid
        revision_id = repository.connection.execute(
            "INSERT INTO source_revisions(source_page_id,external_revision_id,snapshot_path,"
            "content_sha256,fetched_at) VALUES (?,?,?,?, 't')",
            (page_id, int(qid[1:]), f"{qid}.json.gz", "1" * 64),
        ).lastrowid
        repository.connection.execute(
            "INSERT INTO catalog_entries(source_page_id,source_revision_id,analyzed_wikidata_id,state,"
            "classifier_version,classified_at) VALUES (?,?,?,'accepted','v','t')",
            (page_id, revision_id, qid),
        )
        repository.connection.execute(
            "INSERT INTO catalog_entity_links(source_page_id,entity_id,requested_wikidata_id,"
            "resolved_wikidata_id,linked_at) VALUES (?,?,?,?,?)",
            (page_id, entity_id, qid, qid, "2026-09-15T00:00:00+00:00"),
        )
    repository.connection.commit()


class RotatedOffsetUnitTest(unittest.TestCase):
    def test_batch_count_and_offset_bounds(self):
        self.assertEqual(release_batch_count(1, 25), 1)
        self.assertEqual(release_batch_count(25, 25), 1)
        self.assertEqual(release_batch_count(26, 25), 2)
        self.assertEqual(release_batch_count(574, 25), 23)
        with self.assertRaisesRegex(ValueError, "no accepted catalog groups"):
            release_batch_count(0, 25)
        with self.assertRaisesRegex(ValueError, "group_limit must be positive"):
            release_batch_count(10, 0)

    def test_cycle_covers_every_group_index(self):
        limit = MAX_GROUPS_PER_QUERY
        start = date(2026, 11, 1)
        for count in (1, 25, 26, 50, 51, 100, 574):
            with self.subTest(count=count):
                batches = release_batch_count(count, limit)
                covered: set[int] = set()
                offsets: list[int] = []
                for day in range(batches):
                    offset = rotated_release_group_offset(count, limit, start + timedelta(days=day))
                    offsets.append(offset)
                    covered.update(range(offset, min(offset + limit, count)))
                self.assertEqual(covered, set(range(count)))
                self.assertEqual(sorted(offsets), list(range(0, batches * limit, limit)))
                self.assertEqual(
                    rotated_release_group_offset(count, limit, start + timedelta(days=batches)),
                    offsets[0],
                )

    def test_iso_date_string_matches_date_object(self):
        self.assertEqual(
            rotated_release_group_offset(60, 25, "2026-11-20"),
            rotated_release_group_offset(60, 25, date(2026, 11, 20)),
        )


class CatalogCountAndDiscoveryBatchTest(unittest.TestCase):
    def test_count_and_rotated_batches_cover_catalog_qids(self):
        qids = [f"Q{i}" for i in range(1, 58)]  # 57 groups → 3 batches of 25
        limit = 25
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "quiz.db") as repository:
                _seed_accepted_groups(repository, qids)
                self.assertEqual(count_accepted_catalog_groups(repository.connection), 57)
                ordered = [
                    row[0]
                    for row in repository.connection.execute(
                        """
                        SELECT DISTINCT e.wikidata_id FROM entities e
                        JOIN catalog_entity_links cel ON cel.entity_id=e.id
                        JOIN catalog_entries ce ON ce.source_page_id=cel.source_page_id
                        WHERE e.entity_type='group' AND ce.state='accepted'
                        ORDER BY e.wikidata_id
                        """
                    )
                ]
                self.assertEqual(ordered, sorted(qids))
                seen: set[str] = set()
                start = date(2026, 1, 1)
                for day in range(release_batch_count(57, limit)):
                    offset = rotated_release_group_offset(57, limit, start + timedelta(days=day))
                    batch = ordered[offset : offset + limit]
                    seen.update(batch)
                self.assertEqual(seen, set(qids))


class ReleaseRotateCliTest(unittest.TestCase):
    def test_rotate_and_offset_are_mutually_exclusive(self):
        with self.assertRaisesRegex(SystemExit, "use --release-rotate or --release-group-offset"):
            main(
                [
                    "--database",
                    "/tmp/unused.db",
                    "--releases",
                    "--release-rotate",
                    "--release-group-offset",
                    "25",
                ]
            )

    def test_rotate_passes_derived_offset_to_discovery(self):
        totals = FactRunTotals(0, 0, 0, 0, 0, 0, 0, 0)
        captured: dict[str, int] = {}

        class Discovery:
            run_id = 1
            truncated = ()

        def fake_discover(repository, client, group_limit=25, group_offset=0, max_per_group=100):
            captured["limit"] = group_limit
            captured["offset"] = group_offset
            return Discovery()

        with tempfile.TemporaryDirectory() as directory, patch(
            "kpop_scraping.cli.collect_category", return_value=0
        ), patch("kpop_scraping.cli.classify_catalog") as classify, patch(
            "kpop_scraping.cli.extract_facts", return_value=totals
        ), patch(
            "kpop_scraping.cli.export_fact_coverage_csv", return_value=0
        ), patch(
            "kpop_scraping.cli.count_accepted_catalog_groups", return_value=57
        ), patch(
            "kpop_scraping.cli.reference_date_today", return_value="2026-11-20"
        ), patch(
            "kpop_scraping.cli.discover_releases", side_effect=fake_discover
        ), patch(
            "kpop_scraping.cli.collect_release_facts",
            return_value=type(
                "T",
                (),
                {"groups": 0, "entities": 0, "accepted": 0, "rejected": 0, "conflict": 0},
            )(),
        ), patch(
            "kpop_scraping.cli.export_release_coverage_csv", return_value=0
        ), patch("kpop_scraping.cli.WikidataQueryClient"), patch(
            "kpop_scraping.cli.WikidataEntityClient"
        ), patch("kpop_scraping.cli.WikidataTypeClient"), patch(
            "kpop_scraping.cli.MediaWikiClient"
        ), redirect_stdout(io.StringIO()) as stdout:
            classify.return_value.accepted = 57
            classify.return_value.rejected = 0
            classify.return_value.pending = 0
            database = Path(directory) / "test.db"
            code = main(
                ["--database", str(database), "--releases", "--release-rotate"]
            )

        expected = rotated_release_group_offset(57, 25, date(2026, 11, 20))
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(captured, {"limit": 25, "offset": expected})
        self.assertIn(f"Release rotation: offset {expected} of 57 accepted groups", stdout.getvalue())


class ReleaseDiscoveryFailureKeepsFactsTest(unittest.TestCase):
    def test_discovery_failure_after_facts_exits_ok_and_keeps_db(self):
        """Fatos já gravados sobrevivem a uma falha da descoberta; exit 0 evita restore-cache."""
        totals = FactRunTotals(1, 1, 1, 1, 0, 0, 0, 0)
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "test.db"
            with Repository(database) as repository:
                repository.connection.execute(
                    "CREATE TABLE IF NOT EXISTS _probe(id INTEGER PRIMARY KEY, note TEXT)"
                )
                repository.connection.execute(
                    "INSERT INTO _probe(note) VALUES ('facts-marker')"
                )
                repository.connection.commit()

            def extract_and_mark(repo, *args, **kwargs):
                repo.connection.execute(
                    "INSERT INTO _probe(note) VALUES ('facts-saved')"
                )
                repo.connection.commit()
                return totals

            stdout = io.StringIO()
            stderr = io.StringIO()
            with patch("kpop_scraping.cli.collect_category", return_value=0), patch(
                "kpop_scraping.cli.classify_catalog"
            ) as classify, patch(
                "kpop_scraping.cli.extract_facts", side_effect=extract_and_mark
            ), patch(
                "kpop_scraping.cli.export_fact_coverage_csv", return_value=0
            ), patch(
                "kpop_scraping.cli.discover_releases",
                side_effect=MediaWikiError("WDQS request failed", transient=True),
            ), patch("kpop_scraping.cli.WikidataQueryClient"), patch(
                "kpop_scraping.cli.WikidataEntityClient"
            ), patch("kpop_scraping.cli.WikidataTypeClient"), patch(
                "kpop_scraping.cli.MediaWikiClient"
            ), redirect_stdout(stdout), redirect_stderr(stderr):
                classify.return_value.accepted = 1
                classify.return_value.rejected = 0
                classify.return_value.pending = 0
                code = main(["--database", str(database), "--releases"])

            self.assertEqual(code, EXIT_OK)
            self.assertIn("release discovery failed after facts were saved", stderr.getvalue())
            self.assertIn("Releases: skipped after discovery failure", stdout.getvalue())
            with Repository(database) as repository:
                notes = {
                    row[0]
                    for row in repository.connection.execute("SELECT note FROM _probe")
                }
            self.assertEqual(notes, {"facts-marker", "facts-saved"})

    def test_integrity_and_confirmation_errors_keep_failure_exit_codes(self):
        totals = FactRunTotals(0, 0, 0, 0, 0, 0, 0, 0)
        discovery = type("Discovery", (), {"run_id": 1, "truncated": ()})()
        cases = (
            ("discovery", SnapshotIntegrityError("damaged snapshot"), EXIT_DETERMINISTIC),
            ("discovery", RuntimeError("storage failure"), EXIT_DETERMINISTIC),
            ("confirmation", SnapshotIntegrityError("damaged snapshot"), EXIT_DETERMINISTIC),
            ("confirmation", ValueError("invalid release"), EXIT_DETERMINISTIC),
            ("confirmation", MediaWikiError("network failure", transient=True), EXIT_TRANSIENT),
        )
        for stage, error, expected in cases:
            with self.subTest(stage=stage, error=type(error).__name__), tempfile.TemporaryDirectory() as directory:
                with patch("kpop_scraping.cli.collect_category", return_value=0), patch(
                    "kpop_scraping.cli.classify_catalog"
                ) as classify, patch(
                    "kpop_scraping.cli.extract_facts", return_value=totals
                ), patch(
                    "kpop_scraping.cli.export_fact_coverage_csv", return_value=0
                ), patch(
                    "kpop_scraping.cli.discover_releases",
                    return_value=discovery,
                    side_effect=error if stage == "discovery" else None,
                ), patch(
                    "kpop_scraping.cli.collect_release_facts", side_effect=error
                ), patch("kpop_scraping.cli.WikidataQueryClient"), patch(
                    "kpop_scraping.cli.WikidataEntityClient"
                ), patch("kpop_scraping.cli.WikidataTypeClient"), patch(
                    "kpop_scraping.cli.MediaWikiClient"
                ), redirect_stdout(io.StringIO()) as stdout, redirect_stderr(io.StringIO()) as stderr:
                    classify.return_value.accepted = 1
                    classify.return_value.rejected = 0
                    classify.return_value.pending = 0
                    code = main(["--database", str(Path(directory) / "test.db"), "--releases"])
                self.assertEqual(code, expected)
                self.assertIn("Pipeline failed", stdout.getvalue())
                self.assertNotIn("Release discovery skipped", stderr.getvalue())

    def test_offset_beyond_catalog_after_facts_exits_ok(self):
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
        ), redirect_stdout(io.StringIO()) as stdout, redirect_stderr(io.StringIO()) as stderr:
            classify.return_value.accepted = 0
            classify.return_value.rejected = 0
            classify.return_value.pending = 0
            database = Path(directory) / "test.db"
            code = main(
                [
                    "--database",
                    str(database),
                    "--releases",
                    "--release-group-offset",
                    "999",
                ]
            )
        self.assertEqual(code, EXIT_OK)
        self.assertIn("release discovery failed after facts were saved", stderr.getvalue())
        self.assertIn("Releases: skipped after discovery failure", stdout.getvalue())
        self.assertNotIn("Pipeline failed", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
