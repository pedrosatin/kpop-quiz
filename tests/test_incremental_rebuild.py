"""The incremental rebuild writes the same database as a full rebuild of the same day.

Both runs start from a copy of the same database, built the day before by a
full run, and talk to the same fake Action API: the real clients, the real
CLI and the real pipeline run, and only ``urlopen`` is replaced. The day
brings a page with a new revision and extract, a page that left the
category, a new page, a group and a person with new revisions, a label entity
with a new revision and an entity that disappeared. The comparison dumps
every table without the columns that hold the time of the run, plus the CSV
reports and every snapshot file.
"""

import copy
import csv
import gzip
import io
import json
import shutil
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from kpop_scraping.cli import main
from kpop_scraping.exit_codes import EXIT_OK
from kpop_scraping.http_request import DEFAULT_USER_AGENT
from kpop_scraping.mediawiki import MAXLAG_SECONDS
from tests.wikidata_fixture import NAYEON, RED_VELVET, TWICE, WONDER_GIRLS, load_fixture

WIKIPEDIA = "en.wikipedia.org"
WIKIDATA = "www.wikidata.org"
LABEL_PROPS = "info|labels|aliases"
COUNTRY_PROPS = "info|labels|aliases|claims"
SUBJECT_PROPS = "info|labels|aliases|claims|sitelinks/urls"
TYPE_PROPS = "claims|info"


class _Response(io.BytesIO):
    headers: dict = {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class FakeWikimedia:
    """Answer the Action API requests of the collector from an editable fixture."""

    def __init__(self, fixture, wikitext=None):
        self.pages = {page["pageid"]: page for page in fixture["wikipedia_pages"]}
        self.category = list(self.pages)
        self.subjects = fixture["subject_profile"]
        self.labels = fixture["label_profile"]
        self.countries = fixture["country_profile"]
        self.wikitext = wikitext or {}
        self.requests = []
        self._busy = False

    def __call__(self, request, *, timeout):
        # Requests are sequential: none starts while another is open.
        assert not self._busy, "two Wikimedia requests overlapped"
        assert timeout > 0
        assert request.get_header("User-agent") == DEFAULT_USER_AGENT
        parts = urlsplit(request.full_url)
        query = {key: values[0] for key, values in parse_qs(parts.query).items()}
        assert query["maxlag"] == str(MAXLAG_SECONDS)
        self.requests.append((parts.netloc, query))
        self._busy = True
        try:
            if parts.netloc == WIKIPEDIA:
                body = self._wikipedia(query)
            elif parts.netloc == WIKIDATA:
                body = self._wikidata(query)
            else:
                raise AssertionError(f"unexpected host {parts.netloc}")
        finally:
            self._busy = False
        return _Response(json.dumps(body).encode("utf-8"))

    def _wikipedia(self, query):
        if query.get("list") == "categorymembers":
            return {"query": {"categorymembers": [
                {"pageid": page_id, "ns": 0, "title": self.pages[page_id]["title"]}
                for page_id in self.category
            ]}}
        if "revids" in query:
            pages = []
            for revid in map(int, query["revids"].split("|")):
                page = next(page for page in self.pages.values() if page["revid"] == revid)
                pages.append({"pageid": page["pageid"], "revisions": [{
                    "revid": revid,
                    "slots": {"main": {
                        "contentmodel": "wikitext",
                        "content": self.wikitext.get(page["pageid"], ""),
                    }},
                }]})
            return {"query": {"pages": pages}}
        with_extract = "extracts" in query["prop"]
        pages = []
        for page_id in map(int, query["pageids"].split("|")):
            page = self.pages.get(page_id)
            if page is None:
                pages.append({"pageid": page_id, "missing": True})
                continue
            item = {
                "pageid": page_id,
                "ns": 0,
                "title": page["title"],
                "canonicalurl": page["canonicalurl"],
                "touched": "2026-11-18T00:00:00Z",
                "lastrevid": page["revid"],
                "revisions": [{"revid": page["revid"]}],
            }
            if page.get("wikidata_id"):
                item["pageprops"] = {"wikibase_item": page["wikidata_id"]}
            if with_extract:
                item["extract"] = page["extract"]
            pages.append(item)
        return {"query": {"pages": pages}}

    def _entity(self, qid, props):
        if props in (SUBJECT_PROPS, TYPE_PROPS):
            source = self.subjects
        elif props == COUNTRY_PROPS:
            source = self.countries
        elif props == LABEL_PROPS:
            source = self.labels
        else:
            assert props == "info", props
            source = {**self.labels, **self.countries, **self.subjects}
        entity = source.get(qid)
        if entity is None:
            return {"id": qid, "missing": ""}
        if props == "info":
            return {key: entity[key] for key in ("id", "lastrevid", "modified", "ns", "pageid", "title", "type")}
        if props == TYPE_PROPS:
            return {key: entity[key] for key in ("id", "lastrevid", "claims", "type")}
        return copy.deepcopy(entity)

    def _wikidata(self, query):
        assert query["action"] == "wbgetentities"
        ids = query["ids"].split("|")
        assert len(ids) <= 50
        return {"entities": {qid: self._entity(qid, query["props"]) for qid in ids}}

    def count(self, host, **match):
        return sum(
            1 for netloc, query in self.requests
            if netloc == host and all(query.get(key) == value for key, value in match.items())
        )


def next_day(fixture):
    """Change the fixture the way a day of edits on Wikipedia and Wikidata would."""
    day = copy.deepcopy(fixture)
    pages = {page["pageid"]: page for page in day["wikipedia_pages"]}
    red_velvet = next(page for page in pages.values() if page["wikidata_id"] == RED_VELVET)
    red_velvet["revid"] += 1000
    red_velvet["extract"] += " The group released a new album in 2026."
    wonder_girls = next(page for page in pages.values() if page["wikidata_id"] == WONDER_GIRLS)
    day["wikipedia_pages"].remove(wonder_girls)
    day["wikipedia_pages"].append({
        "pageid": 99000001,
        "revid": 1380000001,
        "title": "List of K-pop groups",
        "canonicalurl": "https://en.wikipedia.org/wiki/List_of_K-pop_groups",
        "extract": "This is a list of K-pop groups.",
        "wikidata_id": None,
    })

    twice = day["subject_profile"][TWICE]
    twice["lastrevid"] += 1000
    twice["labels"]["en"]["value"] = "TWICE"
    nayeon = day["subject_profile"][NAYEON]
    nayeon["lastrevid"] += 1000
    nayeon["aliases"].setdefault("en", []).append({"language": "en", "value": "Im Na-yeon"})
    label_qid = sorted(day["label_profile"])[0]
    day["label_profile"][label_qid]["lastrevid"] += 1000
    removed_label = sorted(day["label_profile"])[-1]
    del day["label_profile"][removed_label]
    return day


def dump_database(path):
    """Every row of every table, without the columns that hold the time of the run."""
    connection = sqlite3.connect(path)
    try:
        dump = {}
        tables = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )]
        for table in tables:
            columns = [
                row[1] for row in connection.execute(f"PRAGMA table_info({table})")
                if not row[1].endswith("_at")
            ]
            if not columns:
                continue
            listed = ", ".join(f'"{column}"' for column in columns)
            dump[table] = [columns, *connection.execute(f"SELECT {listed} FROM {table} ORDER BY rowid")]
        return dump
    finally:
        connection.close()


def snapshot_files(raw_dir):
    return {
        str(path.relative_to(raw_dir)): gzip.decompress(path.read_bytes())
        for path in sorted(raw_dir.rglob("*.json.gz"))
    }


def read_csv(path):
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.reader(handle))


class IncrementalRebuildEquivalenceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.fixture = load_fixture()
        self.wikitext = {
            page["pageid"]: f"{{{{Infobox musical artist\n| name = {page['title']}\n}}}}"
            for page in self.fixture["wikipedia_pages"]
        }
        yesterday = self.root / "yesterday"
        self.assertEqual(self.run_cli(yesterday, FakeWikimedia(self.fixture, self.wikitext)), EXIT_OK)
        self.yesterday = yesterday

    def tearDown(self):
        self.directory.cleanup()

    def run_cli(self, folder, fake, *extra):
        folder.mkdir(parents=True, exist_ok=True)
        with patch("kpop_scraping.http_request.urlopen", fake), redirect_stdout(io.StringIO()), \
                redirect_stderr(io.StringIO()):
            return main(["--facts", "--database", str(folder / "kpop.db"), *extra])

    def copy_of_yesterday(self, name):
        target = self.root / name
        shutil.copytree(self.yesterday, target)
        return target

    def assert_same_build(self, full, incremental):
        self.assertEqual(dump_database(full / "kpop.db"), dump_database(incremental / "kpop.db"))
        self.assertEqual(snapshot_files(full / "raw"), snapshot_files(incremental / "raw"))
        for report in ("catalog-report.csv", "facts-coverage.csv"):
            self.assertEqual(read_csv(full / report), read_csv(incremental / report), report)

    def test_incremental_run_writes_what_a_full_run_of_the_same_day_writes(self):
        day = next_day(self.fixture)
        full, incremental = self.copy_of_yesterday("full"), self.copy_of_yesterday("incremental")
        full_api, incremental_api = FakeWikimedia(day, self.wikitext), FakeWikimedia(day, self.wikitext)

        self.assertEqual(self.run_cli(full, full_api), EXIT_OK)
        self.assertEqual(self.run_cli(incremental, incremental_api, "--incremental"), EXIT_OK)

        self.assert_same_build(full, incremental)
        # The day's edits did reach the database.
        connection = sqlite3.connect(incremental / "kpop.db")
        try:
            red_velvet_revision = next(
                page["revid"] for page in day["wikipedia_pages"] if page["wikidata_id"] == RED_VELVET
            )
            self.assertEqual(connection.execute(
                "SELECT revision_id FROM source_pages WHERE wikidata_id=?", (RED_VELVET,)
            ).fetchone()[0], red_velvet_revision)
            self.assertEqual(connection.execute(
                "SELECT external_revision_id FROM wikidata_entity_snapshots "
                "WHERE wikidata_id=? ORDER BY external_revision_id DESC LIMIT 1", (TWICE,)
            ).fetchone()[0], day["subject_profile"][TWICE]["lastrevid"])
        finally:
            connection.close()

        # Extracts were downloaded only for the changed and the new page.
        downloaded = [
            query["pageids"] for netloc, query in incremental_api.requests
            if netloc == WIKIPEDIA and "extracts" in query.get("prop", "")
        ]
        changed = {
            str(page["pageid"]) for page in day["wikipedia_pages"]
            if page["wikidata_id"] == RED_VELVET or page["pageid"] == 99000001
        }
        self.assertEqual({page_id for batch in downloaded for page_id in batch.split("|")}, changed)
        # Entity documents were downloaded only for the revisions not stored yet.
        subject_ids = {
            qid for netloc, query in incremental_api.requests
            if netloc == WIKIDATA and query["props"] == SUBJECT_PROPS
            for qid in query["ids"].split("|")
        }
        self.assertEqual(subject_ids, {TWICE, NAYEON})
        self.assertLess(
            sum(1 for netloc, query in incremental_api.requests if query.get("props", "") != "info"
                and "extracts" not in query.get("prop", "extracts")),
            len(full_api.requests),
        )

    def test_unchanged_day_downloads_no_content_and_still_matches(self):
        full, incremental = self.copy_of_yesterday("full"), self.copy_of_yesterday("incremental")
        full_api = FakeWikimedia(self.fixture, self.wikitext)
        incremental_api = FakeWikimedia(self.fixture, self.wikitext)

        self.assertEqual(self.run_cli(full, full_api), EXIT_OK)
        self.assertEqual(self.run_cli(incremental, incremental_api, "--incremental"), EXIT_OK)

        self.assert_same_build(full, incremental)
        content_requests = [
            query for netloc, query in incremental_api.requests
            if "extracts" in query.get("prop", "")
            or query.get("props") not in (None, "info")
            or "revids" in query
        ]
        self.assertEqual(content_requests, [])

    def test_corrupt_snapshot_still_stops_the_incremental_run(self):
        incremental = self.copy_of_yesterday("incremental")
        snapshot = next((incremental / "raw" / "wikidata").rglob("*.json.gz"))
        snapshot.write_bytes(gzip.compress(b'{"id":"Q1"}'))
        stdout = io.StringIO()
        with patch("kpop_scraping.http_request.urlopen", FakeWikimedia(self.fixture, self.wikitext)), \
                redirect_stdout(stdout), redirect_stderr(io.StringIO()):
            code = main(["--facts", "--incremental", "--database", str(incremental / "kpop.db")])
        self.assertEqual(code, 65)
        self.assertIn("SnapshotIntegrityError", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
