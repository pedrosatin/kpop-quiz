import json
import unittest
from dataclasses import replace
from pathlib import Path

from kpop_scraping.tour_events import (
    CountryIdentity,
    TourEventContext,
    assess_tour_event_candidate,
)


FIXTURE = Path(__file__).parent / "fixtures" / "tour_event_candidate_cases.json"
GROUP_QID = "Q999999999999991"
ARTIST_MBID = "11111111-1111-4111-8111-111111111111"
EVENT_MBID = "22222222-2222-4222-8222-222222222222"
PLACE_MBID = "33333333-3333-4333-8333-333333333333"
CITY_MBID = "44444444-4444-4444-8444-444444444444"


def standard_context() -> TourEventContext:
    return TourEventContext(
        approved_source_hosts=frozenset({"events.example.com"}),
        reviewed_group_artists={GROUP_QID: frozenset({ARTIST_MBID})},
        reviewed_event_artists={EVENT_MBID: frozenset({ARTIST_MBID})},
        place_city_relations={PLACE_MBID: frozenset({CITY_MBID})},
        city_countries={
            CITY_MBID: (CountryIdentity("Q999999999999999", "KR"),),
        },
    )


def fixture_cases():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class TourEventAssessmentTest(unittest.TestCase):
    def test_synthetic_candidates_keep_candidate_status(self):
        case = fixture_cases()[0]
        result = assess_tour_event_candidate(case["candidate"], standard_context())

        self.assertEqual(result.issues, ())
        self.assertTrue(result.ready_for_editor_review)
        self.assertEqual(result.normalized.status, "candidate")
        self.assertEqual(result.normalized.country_iso_3166_1, "KR")

    def test_rejects_cancelled_dates_and_malformed_mbids(self):
        for case in fixture_cases()[1:]:
            with self.subTest(case=case["name"]):
                result = assess_tour_event_candidate(case["candidate"], standard_context())
                self.assertIn(case["expected_issue"], result.issues)
                self.assertFalse(result.ready_for_editor_review)

    def test_unreviewed_source_and_artist_bindings_are_not_ready(self):
        candidate = fixture_cases()[0]["candidate"]
        context = replace(
            standard_context(),
            approved_source_hosts=frozenset(),
            reviewed_group_artists={},
            reviewed_event_artists={},
        )
        result = assess_tour_event_candidate(candidate, context)

        self.assertIn("source_host_not_approved", result.issues)
        self.assertIn("group_artist_binding_unreviewed", result.issues)
        self.assertIn("event_artist_binding_unreviewed", result.issues)
        self.assertFalse(result.ready_for_editor_review)
        self.assertEqual(result.normalized.status, "candidate")

    def test_source_url_must_use_https_without_credentials_or_custom_ports(self):
        candidate = fixture_cases()[0]["candidate"]
        for url in (
            "http://events.example.com/schedule/1",
            "https://user:pass@events.example.com/schedule/1",
            "https://events.example.com:8443/schedule/1",
        ):
            with self.subTest(url=url):
                result = assess_tour_event_candidate(
                    {**candidate, "source_url": url}, standard_context()
                )
                self.assertIn("invalid_source_url", result.issues)
                self.assertFalse(result.ready_for_editor_review)

    def test_requires_a_single_place_city_and_city_country_mapping(self):
        candidate = fixture_cases()[0]["candidate"]
        base = standard_context()
        cases = (
            (
                "unknown city",
                replace(base, city_countries={}),
                "city_country_unresolved",
            ),
            (
                "ambiguous country",
                replace(
                    base,
                    city_countries={
                        CITY_MBID: (
                            CountryIdentity("Q999999999999999", "KR"),
                            CountryIdentity("Q999999999999999", "KR"),
                        )
                    },
                ),
                "city_country_ambiguous",
            ),
            (
                "country identifier mismatch",
                replace(
                    base,
                    city_countries={
                        CITY_MBID: (CountryIdentity("Q999999999999998", "ID"),)
                    },
                ),
                "country_identity_mismatch",
            ),
            (
                "ambiguous place city relation",
                replace(
                    base,
                    place_city_relations={
                        PLACE_MBID: frozenset({CITY_MBID, "55555555-5555-4555-8555-555555555555"})
                    },
                ),
                "place_city_relation_ambiguous",
            ),
            (
                "place in another city",
                replace(base, place_city_relations={PLACE_MBID: frozenset()}),
                "place_city_relation_unreviewed",
            ),
            (
                "ambiguous group artist binding",
                replace(
                    base,
                    reviewed_group_artists={
                        GROUP_QID: frozenset(
                            {ARTIST_MBID, "66666666-6666-4666-8666-666666666666"}
                        )
                    },
                ),
                "group_artist_binding_ambiguous",
            ),
        )
        for name, context, issue in cases:
            with self.subTest(case=name):
                result = assess_tour_event_candidate(candidate, context)
                self.assertIn(issue, result.issues)
                self.assertFalse(result.ready_for_editor_review)

    def test_rejects_unknown_fields_non_concerts_and_supporting_acts(self):
        candidate = {
            **fixture_cases()[0]["candidate"],
            "page_text": "synthetic extra content",
            "event_type": "festival",
            "billing_role": "support",
        }
        result = assess_tour_event_candidate(candidate, standard_context())

        self.assertIn("unknown_field:page_text", result.issues)
        self.assertIn("unsupported_event_type", result.issues)
        self.assertIn("ineligible_billing_role", result.issues)
        self.assertFalse(result.ready_for_editor_review)


if __name__ == "__main__":
    unittest.main()
