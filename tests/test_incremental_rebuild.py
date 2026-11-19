"""The incremental rebuild writes the same database as a full rebuild of the same day.

Both runs start from a copy of the same database, built the day before by a
full run, and talk to the same fake Action API: the real clients, the real
CLI and the real pipeline run, and only ``urlopen`` is replaced. The day
brings a page with a new revision and extract, a page that left the
category, a new page, a group and a person with new revisions, a label entity
with a new revision and an entity that disappeared. The runs pass ``--facts
--releases``, as the daily cron does, so the release pipeline is part of the
proof: WDQS discovery, release entities, their performers and genres, and the
release pages of the English, Portuguese and Korean Wikipedias. The release
day has a release with a new revision, a new release, a release that left the
discovery, releases that stay as they were, a Portuguese release page with a
new revision, a performer and a genre with new revisions. The comparison dumps
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
import re
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
WIKIPEDIAS = {"en": WIKIPEDIA, "pt": "pt.wikipedia.org", "ko": "ko.wikipedia.org"}
WIKIDATA = "www.wikidata.org"
WDQS = "query.wikidata.org"
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
        self.release_pages = fixture["release_pages"]
        self.discovery = fixture["discovery"]
        self.requests = []
        self._busy = False

    def __call__(self, request, *, timeout):
        # Requests are sequential: none starts while another is open.
        assert not self._busy, "two Wikimedia requests overlapped"
        assert timeout > 0
        assert request.get_header("User-agent") == DEFAULT_USER_AGENT
        parts = urlsplit(request.full_url)
        query = {key: values[0] for key, values in parse_qs(parts.query).items()}
        if parts.netloc != WDQS:
            # WDQS is a SPARQL endpoint: maxlag belongs to the Action API.
            assert query["maxlag"] == str(MAXLAG_SECONDS)
        self.requests.append((parts.netloc, query))
        self._busy = True
        try:
            if parts.netloc in WIKIPEDIAS.values():
                body = self._wikipedia(parts.netloc, query)
            elif parts.netloc == WIKIDATA:
                body = self._wikidata(query)
            elif parts.netloc == WDQS:
                body = self._sparql(query)
            else:
                raise AssertionError(f"unexpected host {parts.netloc}")
        finally:
            self._busy = False
        return _Response(json.dumps(body).encode("utf-8"))

    def _sparql(self, query):
        assert query.get("format") == "json"
        listed = re.search(r"VALUES \?performer \{ ([^}]*) \}", query["query"])
        groups = re.findall(r"wd:(Q[0-9]+)", listed.group(1))
        return {"results": {"bindings": [
            {
                "performer": {"type": "uri", "value": f"http://www.wikidata.org/entity/{group}"},
                "release": {"type": "uri", "value": f"http://www.wikidata.org/entity/{release}"},
            }
            for group in groups
            for release in self.discovery.get(group, ())
        ]}}

    def _release_titles(self, host, query):
        language = next(code for code, name in WIKIPEDIAS.items() if name == host)
        pages = []
        for title in query["titles"].split("|"):
            page = self.release_pages[language].get(title)
            if page is None:
                pages.append({"title": title, "missing": True})
                continue
            pages.append({
                "pageid": page["pageid"],
                "ns": 0,
                "title": page["title"],
                "canonicalurl": page["canonicalurl"],
                "touched": "2026-11-18T00:00:00Z",
                "lastrevid": page["revid"],
                "revisions": [{"revid": page["revid"]}],
                "pageprops": {"wikibase_item": page["wikidata_id"]},
                "extract": page["extract"],
            })
        return {"query": {"pages": pages}}

    def _wikipedia(self, host, query):
        if "titles" in query:
            return self._release_titles(host, query)
        assert host == WIKIPEDIA, host
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

    def extract_downloads(self):
        """Page IDs of the category pages whose extract was downloaded."""
        return {
            page_id for netloc, query in self.requests
            if netloc == WIKIPEDIA and "extracts" in query.get("prop", "") and "pageids" in query
            for page_id in query["pageids"].split("|")
        }

    def entity_downloads(self, props):
        """QIDs whose document was downloaded with a profile, not just its revision."""
        return {
            qid for netloc, query in self.requests
            if netloc == WIKIDATA and query["props"] == props
            for qid in query["ids"].split("|")
        }

    def release_page_requests(self):
        """The title queries of the release pages, in order, with their language."""
        return [
            (netloc, query["titles"]) for netloc, query in self.requests
            if netloc in WIKIPEDIAS.values() and "titles" in query
        ]

    def count(self, host, **match):
        return sum(
            1 for netloc, query in self.requests
            if netloc == host and all(query.get(key) == value for key, value in match.items())
        )


ALPHA, BETA, GAMMA, DELTA, EPSILON, ZETA = (f"Q9100000{number}" for number in range(1, 7))
GUEST_GROUP = "Q91000100"
DANCE_POP = "Q91000200"


def _item_statement(subject, property_id, value):
    return {
        "id": f"{subject}${property_id}${value}", "rank": "normal", "type": "statement",
        "mainsnak": {
            "property": property_id, "snaktype": "value", "datatype": "wikibase-item",
            "datavalue": {"type": "wikibase-entityid", "value": {"entity-type": "item", "id": value}},
        },
    }


def _date_statement(subject, day):
    return {
        "id": f"{subject}$P577", "rank": "normal", "type": "statement",
        "mainsnak": {
            "property": "P577", "snaktype": "value", "datatype": "time",
            "datavalue": {"type": "time", "value": {
                "time": f"+{day}T00:00:00Z", "precision": 11,
                "calendarmodel": "http://www.wikidata.org/entity/Q1985727",
            }},
        },
    }


def _wikidata_entity(qid, revision, labels, aliases=(), claims=None, sitelinks=None):
    return {
        "type": "item", "id": qid, "ns": 0, "pageid": int(qid[1:]), "title": qid,
        "lastrevid": revision, "modified": "2026-11-17T00:00:00Z",
        "labels": {language: {"language": language, "value": value} for language, value in labels.items()},
        "aliases": {"en": [{"language": "en", "value": value} for value in aliases]} if aliases else {},
        "claims": claims or {},
        "sitelinks": {
            site: {"site": site, "title": title, "badges": [], "url": f"https://{site[:2]}.wikipedia.org/wiki/{title}"}
            for site, title in (sitelinks or {}).items()
        },
    }


def _release_entity(qid, revision, title, performers, day, titles, aliases=()):
    return _wikidata_entity(
        qid, revision, {"en": title}, aliases,
        claims={
            "P31": [_item_statement(qid, "P31", "Q482994")],
            "P175": [_item_statement(qid, "P175", performer) for performer in performers],
            "P577": [_date_statement(qid, day)],
            "P136": [_item_statement(qid, "P136", DANCE_POP)],
        },
        sitelinks={f"{language}wiki": page for language, page in titles.items()},
    )


def _release_page(language, qid, number, title, extract, revision):
    return {
        "pageid": {"en": 8_000_000, "pt": 8_100_000, "ko": 8_200_000}[language] + number,
        "revid": revision,
        "title": title,
        "canonicalurl": f"https://{language}.wikipedia.org/wiki/{title.replace(' ', '_')}",
        "extract": extract,
        "wikidata_id": qid,
    }


def with_releases(fixture):
    """Add the releases of the first day: six of them, each with Wikipedia pages in some languages.

    Alpha and Beta are by Twice, Gamma, Delta and Epsilon are by Red Velvet,
    and Delta names a guest group that is not in the catalog. Every release
    has the genre Dance-pop. Epsilon exists on Wikidata but WDQS does not
    list it yet.
    """
    world = copy.deepcopy(fixture)
    subjects, labels = world["subject_profile"], world["label_profile"]
    en_title = {ALPHA: "Alpha (Twice album)", BETA: "Beta (Twice album)", GAMMA: "Gamma (Red Velvet album)",
                DELTA: "Delta (Red Velvet song)", EPSILON: "Epsilon (Red Velvet album)", ZETA: "Zeta (Twice album)"}
    pt_title = {ALPHA: "Alpha (álbum)", GAMMA: "Gamma (álbum)"}
    ko_title = {BETA: "베타 (음반)"}
    for number, (qid, performers, day) in enumerate((
        (ALPHA, (TWICE,), "2020-01-02"),
        (BETA, (TWICE,), "2020-02-03"),
        (GAMMA, (RED_VELVET,), "2020-03-04"),
        (DELTA, (RED_VELVET, GUEST_GROUP), "2020-04-05"),
        (EPSILON, (RED_VELVET,), "2020-05-06"),
        (ZETA, (TWICE,), "2020-06-07"),
    ), start=1):
        titles = {"en": en_title[qid]}
        if qid in pt_title:
            titles["pt"] = pt_title[qid]
        if qid in ko_title:
            titles["ko"] = ko_title[qid]
        subjects[qid] = _release_entity(qid, 2_600_000_000 + number, en_title[qid].split(" (")[0], performers, day, titles)
    subjects[GUEST_GROUP] = _wikidata_entity(
        GUEST_GROUP, 2_600_000_100, {"en": "Guest Group", "ko": "게스트 그룹"},
        claims={"P31": [_item_statement(GUEST_GROUP, "P31", "Q641066")]},
    )
    labels[DANCE_POP] = _wikidata_entity(DANCE_POP, 2_600_000_200, {"en": "dance-pop", "pt": "dance-pop"})

    def en_extract(title, kind, group, date):
        return f"{title} is a {kind} by {group}. {title} was released on {date}."

    pages = {"en": {}, "pt": {}, "ko": {}}
    for number, (qid, title, kind, group, date) in enumerate((
        (ALPHA, "Alpha", "studio album", "Twice", "January 2, 2020"),
        (BETA, "Beta", "studio album", "Twice", "February 3, 2020"),
        (GAMMA, "Gamma", "studio album", "Red Velvet", "March 4, 2020"),
        (DELTA, "Delta", "single", "Red Velvet and Guest Group", "April 5, 2020"),
        (EPSILON, "Epsilon", "studio album", "Red Velvet", "May 6, 2020"),
        (ZETA, "Zeta", "studio album", "Twice", "June 7, 2020"),
    ), start=1):
        page = _release_page("en", qid, number, en_title[qid], en_extract(title, kind, group, date), 1_390_000_000 + number)
        pages["en"][page["title"]] = page
    pages["pt"][pt_title[ALPHA]] = _release_page(
        "pt", ALPHA, 1, pt_title[ALPHA],
        "Alpha é um álbum por Twice. Alpha foi lançado em 2 de janeiro de 2020.", 1_391_000_001,
    )
    pages["pt"][pt_title[GAMMA]] = _release_page(
        "pt", GAMMA, 3, pt_title[GAMMA],
        "Gamma é um álbum por Red Velvet. Gamma foi lançado em 4 de março de 2020.", 1_391_000_003,
    )
    pages["ko"][ko_title[BETA]] = _release_page(
        "ko", BETA, 2, ko_title[BETA], "베타는 트와이스의 정규 음반이다. 2020년 2월 3일 발매되었다.", 1_392_000_002,
    )
    world["release_pages"] = pages
    world["discovery"] = {
        TWICE: [ALPHA, BETA, ZETA],
        RED_VELVET: [GAMMA, DELTA],
    }
    return world


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
    group_labels = sorted(qid for qid in day["label_profile"] if qid != DANCE_POP)
    day["label_profile"][group_labels[0]]["lastrevid"] += 1000
    del day["label_profile"][group_labels[-1]]
    release_day(day)
    return day


def release_day(day):
    """The day of the releases: what changes, what stays and what is new or gone."""
    subjects = day["subject_profile"]
    # Beta has a new revision on Wikidata.
    subjects[BETA]["lastrevid"] += 1000
    subjects[BETA]["aliases"] = {"en": [{"language": "en", "value": "Beta Album"}]}
    # The Portuguese page of Gamma has a new revision and a new extract; its Wikidata entity stays.
    gamma = day["release_pages"]["pt"]["Gamma (álbum)"]
    gamma["revid"] += 1000
    gamma["extract"] += " Gamma entrou em várias paradas."
    # The guest performer of Delta and the genre of every release have new revisions.
    subjects[GUEST_GROUP]["lastrevid"] += 1000
    subjects[GUEST_GROUP]["aliases"] = {"en": [{"language": "en", "value": "The Guests"}]}
    day["label_profile"][DANCE_POP]["lastrevid"] += 1000
    day["label_profile"][DANCE_POP]["labels"]["en"]["value"] = "dance pop"
    # WDQS now lists Epsilon, which was on Wikidata but not discovered, and no longer lists Zeta.
    day["discovery"][RED_VELVET].append(EPSILON)
    day["discovery"][TWICE].remove(ZETA)


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
        self.fixture = with_releases(load_fixture())
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
            return main(["--facts", "--releases", "--database", str(folder / "kpop.db"), *extra])

    def copy_of_yesterday(self, name):
        target = self.root / name
        shutil.copytree(self.yesterday, target)
        return target

    def assert_same_build(self, full, incremental):
        self.assertEqual(dump_database(full / "kpop.db"), dump_database(incremental / "kpop.db"))
        self.assertEqual(snapshot_files(full / "raw"), snapshot_files(incremental / "raw"))
        for report in ("catalog-report.csv", "facts-coverage.csv", "release-coverage.csv"):
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

        self.assert_day_reached_the_releases(incremental, day)

        # Extracts were downloaded only for the changed and the new page.
        changed = {
            str(page["pageid"]) for page in day["wikipedia_pages"]
            if page["wikidata_id"] == RED_VELVET or page["pageid"] == 99000001
        }
        self.assertEqual(incremental_api.extract_downloads(), changed)
        # Entity documents were downloaded only for the revisions not stored yet:
        # a group and a person, and among the releases the one with a new
        # revision, the new one and the guest performer.
        self.assertEqual(
            incremental_api.entity_downloads(SUBJECT_PROPS),
            {TWICE, NAYEON, BETA, EPSILON, GUEST_GROUP},
        )
        # The genre of the releases and the label entity of the groups changed; the rest was served from snapshots.
        self.assertEqual(
            incremental_api.entity_downloads(LABEL_PROPS),
            {sorted(qid for qid in self.fixture["label_profile"] if qid != DANCE_POP)[0], DANCE_POP},
        )
        # The full run downloads every release again.
        self.assertTrue({ALPHA, BETA, GAMMA, DELTA, EPSILON, GUEST_GROUP} <= full_api.entity_downloads(SUBJECT_PROPS))
        # WDQS discovery and the release pages are not revision-keyed: both runs ask for the same.
        self.assertEqual(incremental_api.count(WDQS), 1)
        self.assertEqual(full_api.count(WDQS), 1)
        self.assertEqual(incremental_api.release_page_requests(), full_api.release_page_requests())
        self.assertLess(
            sum(1 for netloc, query in incremental_api.requests if query.get("props", "") != "info"
                and "extracts" not in query.get("prop", "extracts")),
            len(full_api.requests),
        )

    def assert_day_reached_the_releases(self, folder, day):
        """The edits of the release day are in the database, not only equal in both runs."""
        connection = sqlite3.connect(folder / "kpop.db")
        try:
            def revisions(qid):
                return {row[0] for row in connection.execute(
                    "SELECT external_revision_id FROM wikidata_entity_snapshots WHERE wikidata_id=?", (qid,)
                )}

            beta = day["subject_profile"][BETA]["lastrevid"]
            self.assertEqual(revisions(BETA), {beta - 1000, beta})
            self.assertEqual(len(revisions(ALPHA)), 1)
            self.assertEqual(len(revisions(GAMMA)), 1)
            guest = day["subject_profile"][GUEST_GROUP]["lastrevid"]
            self.assertEqual(revisions(GUEST_GROUP), {guest - 1000, guest})
            genre = day["label_profile"][DANCE_POP]["lastrevid"]
            self.assertEqual(revisions(DANCE_POP), {genre - 1000, genre})
            self.assertEqual(revisions(EPSILON), {day["subject_profile"][EPSILON]["lastrevid"]})
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM entity_aliases a JOIN entities e ON e.id=a.entity_id "
                "WHERE e.wikidata_id=? AND a.name='The Guests'", (GUEST_GROUP,)
            ).fetchone()[0], 1)
            # The Portuguese page of Gamma kept its old revision and gained the new one.
            gamma_page = day["release_pages"]["pt"]["Gamma (álbum)"]
            self.assertEqual({row[0] for row in connection.execute(
                "SELECT r.external_revision_id FROM source_revisions r JOIN source_pages p ON p.id=r.source_page_id "
                "WHERE p.provider='wikipedia' AND p.language='pt' AND p.external_page_id=?", (gamma_page["pageid"],)
            )}, {gamma_page["revid"] - 1000, gamma_page["revid"]})
            # The new release was accepted with its date; the one that left the discovery is stale.
            states = dict(connection.execute(
                "SELECT resolved_wikidata_id, state FROM release_candidates ORDER BY id"
            ).fetchall())
            self.assertEqual(states[EPSILON], "accepted")
            self.assertEqual(states[ZETA], "stale")
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM facts f JOIN entities e ON e.id=f.subject_entity_id "
                "WHERE e.wikidata_id=? AND f.predicate='released_on' AND f.status='accepted'", (EPSILON,)
            ).fetchone()[0], 1)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM facts f JOIN entities e ON e.id=f.subject_entity_id "
                "WHERE e.wikidata_id=? AND f.status='stale'", (ZETA,)
            ).fetchone()[0], 2)
        finally:
            connection.close()

    def test_unchanged_day_downloads_no_content_and_still_matches(self):
        full, incremental = self.copy_of_yesterday("full"), self.copy_of_yesterday("incremental")
        full_api = FakeWikimedia(self.fixture, self.wikitext)
        incremental_api = FakeWikimedia(self.fixture, self.wikitext)

        self.assertEqual(self.run_cli(full, full_api), EXIT_OK)
        self.assertEqual(self.run_cli(incremental, incremental_api, "--incremental"), EXIT_OK)

        self.assert_same_build(full, incremental)
        content_requests = [
            query for netloc, query in incremental_api.requests
            if ("extracts" in query.get("prop", "") and "titles" not in query)
            or query.get("props") not in (None, "info")
            or "revids" in query
        ]
        self.assertEqual(content_requests, [])
        # No release entity, performer or genre was downloaded either. The
        # release pages and the WDQS discovery are not keyed by revision, so
        # both runs ask for them.
        self.assertEqual(incremental_api.count(WDQS), 1)
        self.assertEqual(incremental_api.release_page_requests(), full_api.release_page_requests())

    def test_corrupt_snapshot_still_stops_the_incremental_run(self):
        incremental = self.copy_of_yesterday("incremental")
        # Yesterday was built with --releases, so raw/wikidata also holds release,
        # performer and genre snapshots that a --facts run never reads. Picking
        # the first rglob hit made the test depend on filesystem order; corrupt
        # every snapshot so the run always meets one it verifies.
        snapshots = sorted((incremental / "raw" / "wikidata").rglob("*.json.gz"))
        self.assertTrue(snapshots)
        for snapshot in snapshots:
            snapshot.write_bytes(gzip.compress(b'{"id":"Q1"}'))
        stdout = io.StringIO()
        with patch("kpop_scraping.http_request.urlopen", FakeWikimedia(self.fixture, self.wikitext)), \
                redirect_stdout(stdout), redirect_stderr(io.StringIO()):
            code = main(["--facts", "--incremental", "--database", str(incremental / "kpop.db")])
        self.assertEqual(code, 65)
        self.assertIn("SnapshotIntegrityError", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
