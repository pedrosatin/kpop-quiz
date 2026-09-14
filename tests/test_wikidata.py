import unittest
from unittest.mock import patch

from kpop_scraping.mediawiki import MediaWikiError
from kpop_scraping.wikidata import (
    LABEL_PROFILE,
    SUBJECT_PROFILE,
    WikidataEntityClient,
    WikidataTypeClient,
)


class WikidataTypeClientTest(unittest.TestCase):
    @patch.object(WikidataTypeClient, "_get")
    def test_maps_revision_and_direct_instance_of_values(self, get):
        get.return_value = {
            "entities": {
                "Q1": {
                    "lastrevid": 77,
                    "claims": {
                        "P31": [
                            {
                                "mainsnak": {
                                    "snaktype": "value",
                                    "datavalue": {"value": {"id": "Q215380"}},
                                }
                            },
                            {
                                "mainsnak": {
                                    "snaktype": "novalue"
                                }
                            },
                        ]
                    },
                }
            }
        }
        check = list(WikidataTypeClient().get_type_checks(["Q1"]))[0]
        self.assertEqual(check.revision_id, 77)
        self.assertEqual(check.instance_of, ("Q215380",))
        self.assertEqual(get.call_args.args[0]["props"], "claims|info")

    def test_rejects_more_than_fifty_entities(self):
        with self.assertRaisesRegex(ValueError, "at most 50"):
            list(WikidataTypeClient().get_type_checks(f"Q{i}" for i in range(1, 52)))

    @patch.object(WikidataTypeClient, "_get")
    def test_deleted_entity_with_empty_missing_marker_is_skipped(self, get):
        # Regression: Wikibase returns "missing": "" for deleted items.
        get.return_value = {"entities": {"Q140917758": {"id": "Q140917758", "missing": ""}}}
        self.assertEqual(list(WikidataTypeClient().get_type_checks(["Q140917758"])), [])


class WikidataEntityClientTest(unittest.TestCase):
    @patch.object(WikidataEntityClient, "_get")
    def test_requests_profile_and_maps_documents(self, get):
        get.return_value = {
            "entities": {
                "Q884": {"id": "Q884", "lastrevid": 2541519294, "labels": {}},
                "Q140917758": {"id": "Q140917758", "missing": ""},
            }
        }
        batch = WikidataEntityClient().get_entities(["Q884", "Q140917758"], LABEL_PROFILE)
        self.assertEqual([doc.wikidata_id for doc in batch.documents], ["Q884"])
        self.assertEqual(batch.documents[0].revision_id, 2541519294)
        self.assertEqual(batch.missing, ("Q140917758",))
        parameters = get.call_args.args[0]
        self.assertEqual(parameters["action"], "wbgetentities")
        self.assertEqual(parameters["props"], "info|labels|aliases")
        self.assertEqual(parameters["languages"], "pt|en|ko")
        self.assertNotIn("sitefilter", parameters)

    @patch.object(WikidataEntityClient, "_get")
    def test_nonexistent_id_is_removed_and_request_repeated(self, get):
        get.side_effect = [
            MediaWikiError(
                "no such entity",
                code="no-such-entity",
                details={"code": "no-such-entity", "id": "Q999999999999"},
            ),
            {"entities": {"Q884": {"id": "Q884", "lastrevid": 7}}},
        ]
        batch = WikidataEntityClient().get_entities(["Q999999999999", "Q884"], SUBJECT_PROFILE)
        self.assertEqual(batch.missing, ("Q999999999999",))
        self.assertEqual(get.call_args_list[1].args[0]["ids"], "Q884")
        self.assertEqual(get.call_args_list[1].args[0]["sitefilter"], "enwiki|ptwiki|kowiki")

    @patch.object(WikidataEntityClient, "_get")
    def test_redirect_keeps_requested_and_resolved_ids(self, get):
        get.return_value = {
            "entities": {
                "Q2": {"id": "Q3", "lastrevid": 9, "redirects": {"from": "Q2", "to": "Q3"}}
            }
        }
        document = WikidataEntityClient().get_entities(["Q2"], LABEL_PROFILE).documents[0]
        self.assertTrue(document.redirected)
        self.assertEqual((document.requested_id, document.wikidata_id), ("Q2", "Q3"))
        self.assertNotIn("redirects", document.payload)

    def test_rejects_more_than_fifty_entities_and_invalid_ids(self):
        client = WikidataEntityClient()
        with self.assertRaisesRegex(ValueError, "at most 50"):
            client.get_entities((f"Q{i}" for i in range(1, 52)), LABEL_PROFILE)
        with self.assertRaisesRegex(ValueError, "invalid Wikidata"):
            client.get_entities(["P31"], LABEL_PROFILE)


if __name__ == "__main__":
    unittest.main()
