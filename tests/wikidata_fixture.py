"""Offline fakes built from reduced real Wikidata and Wikipedia responses."""

import copy
import json
from pathlib import Path

from kpop_scraping.catalog import classify_catalog
from kpop_scraping.collector import collect_category
from kpop_scraping.mediawiki import Page
from kpop_scraping.wikidata import (
    COUNTRY_PROFILE,
    SUBJECT_PROFILE,
    EntityBatch,
    EntityDocument,
    TypeCheck,
)


FIXTURE = Path(__file__).parent / "fixtures" / "wikidata_entities.json"

TWICE = "Q20645861"
RED_VELVET = "Q17466114"
WONDER_GIRLS = "Q476119"
NAYEON = "Q22804243"
TZUYU = "Q20688219"
WENDY = "Q17478642"
YERI = "Q19940498"
SUNYE = "Q483642"
SUNMI = "Q624995"


def load_fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class FixturePageClient:
    provider = "wikipedia"
    language = "en"

    def __init__(self, fixture):
        self.pages = {page["pageid"]: page for page in fixture["wikipedia_pages"]}

    def iter_category_members(self, _category):
        for page_id in self.pages:
            yield {"pageid": page_id, "title": self.pages[page_id]["title"]}

    def get_pages(self, page_ids):
        result = []
        for page_id in page_ids:
            page = self.pages[page_id]
            payload = {
                "canonicalurl": page["canonicalurl"],
                "extract": page["extract"],
                "pageid": page_id,
                "revisions": [{"revid": page["revid"]}],
                "title": page["title"],
            }
            result.append(
                Page(
                    page_id=page_id,
                    title=page["title"],
                    canonical_url=page["canonicalurl"],
                    extract=page["extract"],
                    revision_id=page["revid"],
                    source_payload=payload,
                    wikidata_id=page["wikidata_id"],
                )
            )
        return result


class FixtureWikidataClient:
    """Serve entity documents per profile and record every batch."""

    def __init__(self, fixture):
        self.subjects = copy.deepcopy(fixture["subject_profile"])
        self.labels = copy.deepcopy(fixture["label_profile"])
        self.countries = copy.deepcopy(fixture["country_profile"])
        self.calls = []

    def get_type_checks(self, wikidata_ids):
        for wikidata_id in wikidata_ids:
            entity = self.subjects[wikidata_id]
            classes = tuple(
                statement["mainsnak"]["datavalue"]["value"]["id"]
                for statement in entity["claims"]["P31"]
            )
            yield TypeCheck(wikidata_id, entity["lastrevid"], classes)

    def get_entities(self, wikidata_ids, profile):
        ids = list(wikidata_ids)
        self.calls.append((profile.name, tuple(ids)))
        source = {
            SUBJECT_PROFILE.name: self.subjects,
            COUNTRY_PROFILE.name: self.countries,
        }.get(profile.name, self.labels)
        documents = tuple(
            EntityDocument(qid, qid, source[qid]["lastrevid"], source[qid])
            for qid in ids
            if qid in source
        )
        missing = tuple(qid for qid in ids if qid not in source)
        return EntityBatch(documents, missing)


def build_catalog(repository, fixture):
    collect_category(FixturePageClient(fixture), repository, "Category:K-pop music groups")
    classify_catalog(repository, FixtureWikidataClient(fixture))


def statement(entity, property_id, index=0):
    return entity["claims"][property_id][index]
