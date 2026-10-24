import unittest

from kpop_scraping.release_facts import release_entity_type, release_fact_candidates


def item_statement(statement_id, property_id, value, qualifiers=None, snaktype="value"):
    mainsnak = {"property": property_id, "snaktype": snaktype}
    if snaktype == "value":
        mainsnak["datatype"] = "wikibase-item"
        mainsnak["datavalue"] = {"type": "wikibase-entityid", "value": {"id": value}}
    return {
        "id": statement_id,
        "rank": "normal",
        "type": "statement",
        "mainsnak": mainsnak,
        "qualifiers": qualifiers or {},
        "references": [],
    }


def time_statement(statement_id, property_id, qualifiers=None):
    return {
        "id": statement_id,
        "rank": "normal",
        "type": "statement",
        "mainsnak": {
            "property": property_id,
            "snaktype": "value",
            "datatype": "time",
            "datavalue": {
                "type": "time",
                "value": {
                    "time": "+2020-01-02T00:00:00Z",
                    "precision": 11,
                    "calendarmodel": "http://www.wikidata.org/entity/Q1985727",
                },
            },
        },
        "qualifiers": qualifiers or {},
        "references": [],
    }


class ReleaseFactsTest(unittest.TestCase):
    def test_release_entity_type_album(self):
        entity = {"claims": {"P31": [item_statement("s1", "P31", "Q482994")]}}
        self.assertEqual(release_entity_type(entity), "album")

    def test_release_entity_type_release(self):
        entity = {"claims": {"P31": [item_statement("s1", "P31", "Q169930")]}}
        self.assertEqual(release_entity_type(entity), "release")
        entity2 = {"claims": {"P31": [item_statement("s1", "P31", "Q134556")]}}
        self.assertEqual(release_entity_type(entity2), "release")

    def test_release_entity_type_both(self):
        # If it has both, album takes precedence
        entity = {
            "claims": {
                "P31": [
                    item_statement("s1", "P31", "Q482994"),
                    item_statement("s2", "P31", "Q169930"),
                ]
            }
        }
        self.assertEqual(release_entity_type(entity), "album")

    def test_release_entity_type_neither(self):
        entity = {"claims": {"P31": [item_statement("s1", "P31", "Q12345")]}}
        self.assertIsNone(release_entity_type(entity))

    def test_release_entity_type_no_claims(self):
        self.assertIsNone(release_entity_type({}))
        self.assertIsNone(release_entity_type({"claims": {}}))
        self.assertIsNone(release_entity_type({"claims": {"P31": []}}))

    def test_release_entity_type_novalue(self):
        entity = {
            "claims": {"P31": [item_statement("s1", "P31", None, snaktype="novalue")]}
        }
        self.assertIsNone(release_entity_type(entity))

    def test_release_fact_candidates_extraction(self):
        entity = {
            "claims": {
                "P175": [item_statement("s1", "P175", "Q123")],  # performed_by
                "P577": [time_statement("s2", "P577")],  # released_on
                "P136": [item_statement("s3", "P136", "Q456")],  # release_genre
            }
        }
        extracted = release_fact_candidates("Q1", entity)
        predicates = {c.predicate for c in extracted.candidates}
        self.assertIn("performed_by", predicates)
        self.assertIn("released_on", predicates)
        self.assertIn("release_genre", predicates)

        # Check values
        performed_by = next(
            c for c in extracted.candidates if c.predicate == "performed_by"
        )
        self.assertEqual(performed_by.value_id, "Q123")
        self.assertIsNone(performed_by.error)

        released_on = next(
            c for c in extracted.candidates if c.predicate == "released_on"
        )
        self.assertIsNone(released_on.error)
        self.assertEqual(released_on.time.value, "2020-01-02")

        genre = next(c for c in extracted.candidates if c.predicate == "release_genre")
        self.assertEqual(genre.value_id, "Q456")

    def test_release_fact_candidates_scoped_release_date(self):
        # A qualifier on a release date statement triggers the scoped_release_date error
        qualifiers = {
            "P291": [
                {
                    "snaktype": "value",
                    "property": "P291",
                    "datatype": "wikibase-item",
                    "datavalue": {"type": "wikibase-entityid", "value": {"id": "Q17"}},
                }
            ]
        }
        entity = {
            "claims": {
                "P577": [time_statement("s2", "P577", qualifiers=qualifiers)],
            }
        }
        extracted = release_fact_candidates("Q1", entity)
        self.assertEqual(len(extracted.candidates), 1)
        candidate = extracted.candidates[0]
        self.assertEqual(candidate.predicate, "released_on")
        self.assertEqual(candidate.error, "scoped_release_date")


if __name__ == "__main__":
    unittest.main()
